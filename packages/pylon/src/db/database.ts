import {AsyncLocalStorage} from 'node:async_hooks'
import {Kysely, PostgresDialect} from 'kysely'
import {Pool, types, type PoolConfig} from 'pg'
import {dbLog} from './app-context.js'

// `pg` returns int8 (bigint/bigserial) as a string to avoid precision loss.
// Auto-increment PKs are typed as `number` in models, so parse int8 back to a
// JS number. Values beyond Number.MAX_SAFE_INTEGER are not expected for PKs.
types.setTypeParser(types.builtins.INT8, value =>
  value === null ? null : Number(value)
)

export interface DatabaseOptions {
  connectionString?: string
  pool?: Pool
  poolConfig?: PoolConfig
  /** Skip lifecycle signals (preSave/postSave/preDelete/postDelete) by default on
   *  this connection — and therefore the realtime + transactional-outbox handlers
   *  that hang off them. For bulk seed / import / data-migration processes where
   *  per-row hooks are unwanted. A per-op `{signals: true}` still overrides. */
  skipSignals?: boolean
}

/** Run one after-commit callback with its error isolated + logged. The transaction
 *  has already committed, so a failing hook must NEVER throw back into the caller
 *  (that would masquerade as a write failure). Logged unconditionally — a swallowed
 *  post-commit exception the operator can't see is worse than a log line. */
async function runAfterCommit(cb: () => void | Promise<unknown>): Promise<void> {
  try {
    await cb()
  } catch (err) {
    console.error(
      '[pylon-db] after-commit handler failed (transaction already committed):',
      err instanceof Error ? (err.stack ?? err.message) : err
    )
  }
}

export class Database {
  readonly kysely: Kysely<any>
  /** True when this Database is bound to a transaction (not a pool). */
  readonly transactional: boolean = false
  /** Default-off lifecycle signals for this connection (bulk import/migration).
   *  Inherited by the transactional child in `databaseForKysely`. */
  readonly skipSignals: boolean = false
  private readonly pool: Pool
  private _queryCount = 0
  /** Callbacks registered via `onCommit`, drained after the OUTERMOST commit. */
  private _afterCommit?: Array<() => void | Promise<unknown>>

  constructor(options: DatabaseOptions = {}) {
    ;(this as {skipSignals: boolean}).skipSignals = options.skipSignals ?? false
    this.pool =
      options.pool ??
      new Pool(
        options.poolConfig ?? {connectionString: options.connectionString}
      )
    this.kysely = new Kysely<any>({
      dialect: new PostgresDialect({pool: this.pool}),
      log: event => {
        if (event.level === 'query') {
          this._queryCount++
          dbLog('query', event.query.sql, {
            params: event.query.parameters,
            ms: Math.round(event.queryDurationMillis)
          })
        } else if (event.level === 'error') {
          dbLog('query', 'ERROR executing query', {
            sql: event.query.sql,
            error:
              event.error instanceof Error
                ? event.error.message
                : String(event.error)
          })
        }
      }
    })
  }

  /** Number of SQL queries executed (useful for asserting N+1 elimination). */
  get queryCount(): number {
    return this._queryCount
  }

  resetQueryCount(): void {
    this._queryCount = 0
  }

  /** Run a function with this database bound as the ambient connection. */
  run<T>(fn: () => T): T {
    return databaseContext.run(this, fn)
  }

  /**
   * Run `fn` inside a transaction, bound as the ambient connection — every ORM
   * write within (and any signal/outbox enqueue) commits or rolls back together.
   *
   * REENTRANT: if `this` is already a transaction, JOIN it (`run`) instead of
   * opening another (Postgres has no real nested transactions, and kysely throws
   * on `.transaction()` of a transaction). So a `transaction()` — or a
   * self-transactional `saveInstance` — nested inside an outer `transaction()`
   * participates in the one ambient transaction: inner failure rolls back the
   * whole thing.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.transactional) return this.run(fn) // already in a txn → join it
    let txDb: Database | undefined
    const result = await this.kysely.transaction().execute(trx => {
      txDb = databaseForKysely(trx, this.skipSignals)
      return txDb.run(fn)
    })
    // `execute()` resolves ONLY on COMMIT (it throws on rollback), so any callbacks
    // registered via `onCommit` during `fn` now run — outside the transaction, on
    // the committed data. On rollback we never reach here, so they're dropped.
    if (txDb) await txDb.flushAfterCommit()
    return result
  }

  /**
   * Register `cb` to run AFTER the current transaction commits, OUTSIDE it. For side
   * effects that must not run on rollback and must never veto or break the write:
   * realtime pokes, cache invalidation, webhooks, external notifications. Errors are
   * isolated — a committed transaction cannot be undone, so the hook can't fail the
   * write. Reentrancy-safe: nested `transaction()`/`saveInstance` calls JOIN the
   * outer txn, so their `onCommit`s all fire together after the OUTER commit.
   *
   * With no transaction open, the ambient write has already autocommitted (each
   * statement is its own txn), so `cb` runs on the next microtask — still "after the
   * write is durable".
   */
  onCommit(cb: () => void | Promise<unknown>): void {
    if (this.transactional) {
      ;(this._afterCommit ??= []).push(cb)
    } else {
      void runAfterCommit(cb)
    }
  }

  /** Drain + run the after-commit queue in registration order (outermost only). */
  private async flushAfterCommit(): Promise<void> {
    const cbs = this._afterCommit
    if (!cbs || cbs.length === 0) return
    this._afterCommit = undefined
    for (const cb of cbs) await runAfterCommit(cb)
  }

  async destroy(): Promise<void> {
    await this.kysely.destroy()
  }
}

/**
 * Per-request ambient connection. Pylon integration (Phase 3) will populate this
 * from `getContext()`; today it is set explicitly via `Database.run()` or a
 * process-wide default from `connect()`.
 */
const databaseContext = new AsyncLocalStorage<Database>()
let defaultDatabase: Database | undefined

export function connect(options: DatabaseOptions): Database {
  defaultDatabase = new Database(options)
  return defaultDatabase
}

export function setDefaultDatabase(db: Database | undefined): void {
  defaultDatabase = db
}

export function getDatabase(): Database {
  const db = databaseContext.getStore() ?? defaultDatabase
  if (!db) {
    throw new Error(
      'No active database. Call connect({connectionString}) or run inside Database.run().'
    )
  }
  return db
}

/** True when the ambient bound database is a transaction (for the outbox path). */
export function inTransaction(): boolean {
  return databaseContext.getStore()?.transactional === true
}

/**
 * Run `fn` inside a transaction on the AMBIENT connection — free-function sugar
 * for `getDatabase().transaction(fn)`:
 *
 *   await transaction(async () => { … })   // not getDatabase().transaction(…)
 *
 * Resolvers shouldn't touch the `Database` handle just to open a transaction; it
 * resolves the ambient connection the same way `Model.objects` does. Every ORM
 * write within (and any signal/outbox enqueue) commits or rolls back together.
 */
export function transaction<T>(fn: () => Promise<T>): Promise<T> {
  return getDatabase().transaction(fn)
}

/**
 * Run `cb` after the ambient transaction commits (see `Database.onCommit`) — the
 * Django `transaction.on_commit` analogue. Free-function sugar so app + signal code
 * needn't reach for the `Database` handle:
 *
 *   onCommit(() => publishChange({orgId, table}))  // fire a realtime poke post-commit
 */
export function onCommit(cb: () => void | Promise<unknown>): void {
  getDatabase().onCommit(cb)
}

/**
 * A `Database` view bound to a specific Kysely instance — e.g. a transaction —
 * with no pool of its own. Used by the migration runner to run each migration's
 * ops inside a transaction: `trxDb.run(() => …)` makes the ambient `getDatabase()`
 * (and therefore every manager / historical model) resolve to the transaction,
 * so all of a migration's writes commit or roll back together.
 */
export function databaseForKysely(
  kysely: Kysely<any>,
  skipSignals = false
): Database {
  const db = Object.create(Database.prototype) as Database
  const w = db as unknown as {
    kysely: Kysely<any>
    pool?: Pool
    _queryCount: number
    transactional: boolean
    skipSignals: boolean
  }
  w.kysely = kysely
  w.pool = undefined
  w._queryCount = 0
  w.transactional = true
  w.skipSignals = skipSignals
  return db
}
