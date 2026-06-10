/**
 * `useDatabase()` — the thin RUNTIME integration between the ORM and a Pylon app.
 *
 * The ORM core (models, manager, migrations) is a standalone library — the
 * migration CLI and `pylon build` must stay pure and never run the app, so they
 * use it directly, not through a plugin. What a plugin *is* for is runtime
 * wiring: connect on startup from config, and bind the request's connection so
 * every resolver's `Model.objects.*` resolves through it.
 *
 * It plugs into the same `databaseContext` AsyncLocalStorage the migration runner
 * uses to thread transactions — so `transactionPerRequest` wraps each request in
 * one transaction (committed on success, rolled back if the handler throws),
 * with zero changes to resolver code.
 *
 * Decoupled by design: this returns a plain `{setup, middleware}` object that's
 * structurally a Pylon `Plugin` — pylon-db takes no dependency on `@getcronit/pylon`.
 *
 * ```ts
 * // pylon.config.ts
 * import {useDatabase} from '@getcronit/pylon-db'
 * export default {plugins: [useDatabase()]} satisfies PylonConfig
 * ```
 */
import {connect, databaseForKysely, getDatabase} from './database.js'

export interface UseDatabaseOptions {
  /** Defaults to `process.env.DATABASE_URL` (else standard `PG*` env vars). */
  connectionString?: string
  /**
   * Run each request inside a single transaction, bound as the ambient
   * connection — committed when the handler resolves, rolled back if it throws.
   */
  transactionPerRequest?: boolean
}

export interface DatabasePlugin {
  setup(): void
  middleware(c: unknown, next: () => Promise<void>): Promise<void>
}

export function useDatabase(options: UseDatabaseOptions = {}): DatabasePlugin {
  return {
    setup() {
      connect({connectionString: options.connectionString ?? process.env.DATABASE_URL})
    },
    async middleware(_c, next) {
      const db = getDatabase()
      if (options.transactionPerRequest) {
        await db.kysely.transaction().execute(trx => databaseForKysely(trx).run(() => next()))
      } else {
        // Bind this request to the connection via the ambient store.
        await db.run(() => next())
      }
    }
  }
}
