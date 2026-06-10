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

export interface DbCommandOptions {
  command: 'status' | 'diff' | 'migrate' | 'rollback' | 'resolve' | 'plan' | 'check'
  /** Migration name (for `diff`; the target for `resolve`). */
  name?: string
  /** `plan`: render down SQL instead of up. */
  down?: boolean
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
  applied?: string[]
  /** `rollback`: reversed migration names. */
  rolledBack?: string[]
  /** `resolve`: `{name, as}` recorded in the ledger. */
  resolved?: {name: string; as: 'applied' | 'rolled-back'}
  /** `plan`: per-migration SQL preview. */
  plan?: Array<{name: string; statements: string[]}>
  /** `check`: CI gate result. */
  check?: {uncaptured: number; tampered: string[]; unapplied: string[]}
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
      return {command: 'status', status}
    }
    case 'diff': {
      const created = await runner.generate(options.name ?? 'migration', loadMigrationFile)
      const destructive = (created?.changes as SchemaChange[] | undefined)?.some(isDestructive)
      return {command: 'diff', created: created?.name ?? null, destructive: destructive ?? false}
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
      return {
        command: 'check',
        check: {
          uncaptured: status.pendingChanges.length,
          tampered,
          unapplied: status.unapplied
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
  }
}
