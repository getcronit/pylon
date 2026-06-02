import {AsyncLocalStorage} from 'node:async_hooks'
import {Kysely, PostgresDialect} from 'kysely'
import {Pool, types, type PoolConfig} from 'pg'

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
}

export class Database {
  readonly kysely: Kysely<any>
  private readonly pool: Pool
  private _queryCount = 0

  constructor(options: DatabaseOptions = {}) {
    this.pool =
      options.pool ??
      new Pool(
        options.poolConfig ?? {connectionString: options.connectionString}
      )
    this.kysely = new Kysely<any>({
      dialect: new PostgresDialect({pool: this.pool}),
      log: event => {
        if (event.level === 'query') this._queryCount++
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
