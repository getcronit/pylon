/**
 * `pylon db` — schema migrations driven by the ORM's IR.
 *
 * The crux is loading the user's models so their `@model()` decorators populate
 * the registry, then driving the migration runner on the SAME
 * `@getcronit/pylon-orm` instance the models registered into. We do this
 * in-process: bundle the models entry to a temp ESM file *inside the project*
 * (so its bare imports resolve against the project's node_modules), import it,
 * then resolve the project's pylon-orm and drive `MigrationRunner` from it.
 */
import path from 'node:path'
import {loadProjectOrm} from '../orm-bridge.js'

export interface DbCommandOptions {
  command: 'status' | 'diff' | 'migrate'
  /** Migration name (for `diff`). */
  name?: string
  /** Entry that imports the models (default `./src/index.ts`). */
  models?: string
  /** Migrations directory (default `./migrations`). */
  dir?: string
  /** Project root (default `process.cwd()`). */
  cwd?: string
}

export interface DbCommandResult {
  command: DbCommandOptions['command']
  /** `diff`: created migration name (or null). `migrate`: applied names. */
  created?: string | null
  applied?: string[]
  status?: {pendingChanges: unknown[]; migrations: string[]; unapplied: string[]}
}

export async function runDbCommand(
  options: DbCommandOptions
): Promise<DbCommandResult> {
  const cwd = options.cwd ?? process.cwd()
  const modelsEntry = path.resolve(cwd, options.models ?? './src/index.ts')
  const dir = path.resolve(cwd, options.dir ?? './migrations')

  const orm = await loadProjectOrm(cwd, modelsEntry)
  const runner = new orm.MigrationRunner({dir})

  switch (options.command) {
    case 'status': {
      // Connect when a DB is available so status can read the applied-migrations
      // ledger and report `unapplied` accurately; without a DB it can only show
      // pending (uncaptured) changes and treats every migration as unapplied.
      const db = process.env.DATABASE_URL
        ? orm.connect({connectionString: process.env.DATABASE_URL})
        : undefined
      const status = await runner.status(db)
      return {command: 'status', status}
    }
    case 'diff': {
      const created = await runner.generate(options.name ?? 'migration')
      return {command: 'diff', created: created?.name ?? null}
    }
    case 'migrate': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db migrate requires DATABASE_URL to be set.')
      }
      orm.connect({connectionString})
      const applied = await runner.apply()
      return {command: 'migrate', applied}
    }
  }
}
