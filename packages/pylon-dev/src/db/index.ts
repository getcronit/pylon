/**
 * `pylon db` — schema migrations driven by the ORM's IR.
 *
 * The crux is loading the user's models so their `@model()` decorators populate
 * the registry, then driving the migration runner on the SAME
 * `@getcronit/pylon-db` instance the models registered into. We do this
 * in-process: bundle the models entry to a temp ESM file *inside the project*
 * (so its bare imports resolve against the project's node_modules), import it,
 * then resolve the project's pylon-orm and drive `MigrationRunner` from it.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import esbuild from 'esbuild'
import {isDestructive, type SchemaChange} from '@getcronit/pylon-ir'
import {loadProjectOrm} from '../orm-bridge.js'

let migrationCounter = 0

/**
 * Build a migration loader bound to the project root. Migration files are TS, so
 * the CLI transpiles them (esbuild) — keeping pylon-db transpiler-free. The temp
 * bundle is written *inside the project* (like the models-entry bridge) so its
 * external `@getcronit/pylon-db` import — and any models it touches — resolve to
 * the project's own instance, not a copy. The migrations dir may live anywhere
 * (e.g. a tmpdir in tests), so we can't emit the temp beside the source file.
 */
function createMigrationLoader(cwd: string) {
  return async function loadMigrationFile(filePath: string): Promise<unknown> {
    const tmp = path.join(cwd, `.pylon-migration.${process.pid}.${migrationCounter++}.mjs`)
    await esbuild.build({
      entryPoints: [filePath],
      outfile: tmp,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      logLevel: 'silent',
      tsconfigRaw: {
        compilerOptions: {experimentalDecorators: true, useDefineForClassFields: false}
      }
    })
    try {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(tmp).href)) as {default: unknown}
      return mod.default
    } finally {
      await fs.rm(tmp, {force: true})
    }
  }
}

type SchemaDrift = {
  missingTables: string[]
  extraTables: string[]
  columns: Array<{table: string; missing: string[]; extra: string[]}>
}

export interface DbCommandOptions {
  command:
    | 'status'
    | 'diff'
    | 'migrate'
    | 'rollback'
    | 'resolve'
    | 'plan'
    | 'check'
    | 'push'
    | 'deploy'
    | 'squash'
    | 'merge'
  /** Migration name (for `diff`; the target for `resolve`). */
  name?: string
  /** `plan`: render down SQL instead of up. */
  down?: boolean
  /** `diff`: confirmed renames (drop+add → renameColumn, data-preserving). */
  renames?: Array<{table: string; from: string; to: string}>
  /** Entry that imports the models (default `./src/index.ts`). */
  models?: string
  /** Migrations directory (default `./migrations`). */
  dir?: string
  /** Project root (default `process.cwd()`). */
  cwd?: string
  /** `rollback`: how many migrations to reverse (default 1). */
  steps?: number
  /** `resolve`: mark the migration applied or rolled-back in the ledger. */
  resolve?: 'applied' | 'rolled-back'
}

export interface DbCommandResult {
  command: DbCommandOptions['command']
  /** `diff`: created migration name (or null). `migrate`: applied names. */
  created?: string | null
  /** `diff`: whether the generated migration drops data. */
  destructive?: boolean
  /** `diff`: possible renames not confirmed via --rename (data-loss warning). */
  renameCandidates?: Array<{table: string; from: string; to: string}>
  applied?: string[]
  /** `rollback`: reversed migration names. */
  rolledBack?: string[]
  /** `resolve`: `{name, as}` recorded in the ledger. */
  resolved?: {name: string; as: 'applied' | 'rolled-back'}
  /** `plan`: per-migration SQL preview. */
  plan?: Array<{name: string; statements: string[]}>
  /** `check`: CI gate result. */
  check?: {uncaptured: number; tampered: string[]; unapplied: string[]; drift?: SchemaDrift}
  status?: {pendingChanges: unknown[]; migrations: string[]; unapplied: string[]}
  /** `status`/`check`: live-DB drift (when a database is available). */
  drift?: SchemaDrift
  /** `push`: whether the schema was synced. */
  pushed?: boolean
  /** `squash`: the new migration name + the ones it replaced. */
  squashed?: {name: string; replaced: string[]} | null
  /** `merge`: the merge migration + the heads it reconverged (or null). */
  merged?: {name: string; heads: string[]} | null
}

export async function runDbCommand(
  options: DbCommandOptions
): Promise<DbCommandResult> {
  const cwd = options.cwd ?? process.cwd()
  const modelsEntry = path.resolve(cwd, options.models ?? './src/index.ts')
  const dir = path.resolve(cwd, options.dir ?? './migrations')

  const orm = await loadProjectOrm(cwd, modelsEntry)
  const runner = new orm.MigrationRunner({dir})
  const loadMigrationFile = createMigrationLoader(cwd)

  switch (options.command) {
    case 'status': {
      // Connect when a DB is available so status can read the applied-migrations
      // ledger and report `unapplied` accurately; without a DB it can only show
      // pending (uncaptured) changes and treats every migration as unapplied.
      const db = process.env.DATABASE_URL
        ? orm.connect({connectionString: process.env.DATABASE_URL})
        : undefined
      const status = await runner.status(loadMigrationFile, db)
      const drift = db ? await orm.schemaDrift(db) : undefined
      return {command: 'status', status, drift}
    }
    case 'diff': {
      const created = await runner.generate(options.name ?? 'migration', loadMigrationFile, {
        renames: options.renames
      })
      const destructive = (created?.changes as SchemaChange[] | undefined)?.some(isDestructive)
      return {
        command: 'diff',
        created: created?.name ?? null,
        destructive: destructive ?? false,
        renameCandidates: created?.renameCandidates ?? []
      }
    }
    case 'plan': {
      const plan = await runner.plan(loadMigrationFile, options.down ? 'down' : 'up')
      return {command: 'plan', plan}
    }
    case 'check': {
      const db = process.env.DATABASE_URL
        ? orm.connect({connectionString: process.env.DATABASE_URL})
        : undefined
      const status = await runner.status(loadMigrationFile, db)
      const tampered = db ? await runner.integrityErrors(loadMigrationFile, db) : []
      const drift = db ? await orm.schemaDrift(db) : undefined
      return {
        command: 'check',
        check: {
          uncaptured: status.pendingChanges.length,
          tampered,
          unapplied: status.unapplied,
          drift
        }
      }
    }
    case 'migrate': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db migrate requires DATABASE_URL to be set.')
      }
      const conn = orm.connect({connectionString})
      const applied = await runner.apply(loadMigrationFile, conn)
      return {command: 'migrate', applied}
    }
    case 'rollback': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db rollback requires DATABASE_URL to be set.')
      }
      const conn = orm.connect({connectionString})
      const rolledBack = await runner.rollback(loadMigrationFile, conn, {steps: options.steps ?? 1})
      return {command: 'rollback', rolledBack}
    }
    case 'resolve': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db resolve requires DATABASE_URL to be set.')
      }
      if (!options.name) throw new Error('pylon db resolve requires a migration name.')
      const as = options.resolve ?? 'applied'
      const conn = orm.connect({connectionString})
      if (as === 'applied') await runner.markApplied(options.name, loadMigrationFile, conn)
      else await runner.markRolledBack(options.name, conn)
      return {command: 'resolve', resolved: {name: options.name, as}}
    }
    case 'push': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db push requires DATABASE_URL to be set.')
      }
      orm.connect({connectionString})
      await orm.syncSchema()
      return {command: 'push', pushed: true}
    }
    case 'squash': {
      // Connect only if a DB is available, so the ledger can be reconciled.
      const conn = process.env.DATABASE_URL
        ? orm.connect({connectionString: process.env.DATABASE_URL})
        : undefined
      const squashed = await runner.squash(loadMigrationFile, options.name ?? 'squashed', conn)
      return {command: 'squash', squashed}
    }
    case 'merge': {
      const merged = await runner.merge(loadMigrationFile, options.name ?? 'merge')
      return {command: 'merge', merged}
    }
    case 'deploy': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db deploy requires DATABASE_URL to be set.')
      }
      const conn = orm.connect({connectionString})
      // Prod guards: don't deploy with un-generated model changes or a tampered
      // history. (Drift is reported by `status`/`check`; deploy only applies.)
      const status = await runner.status(loadMigrationFile, conn)
      if (status.pendingChanges.length > 0) {
        throw new Error(
          'Refusing to deploy: uncaptured model changes — run `pylon db diff` and commit the migration.'
        )
      }
      const tampered = await runner.integrityErrors(loadMigrationFile, conn)
      if (tampered.length > 0) {
        throw new Error(`Refusing to deploy: tampered migration(s): ${tampered.join(', ')}`)
      }
      const applied = await runner.apply(loadMigrationFile, conn)
      return {command: 'deploy', applied}
    }
  }
}
