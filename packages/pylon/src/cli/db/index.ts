/**
 * `pylon db` — schema migrations driven by the ORM's IR.
 *
 * The crux is loading the user's models so their `@model()` decorators populate
 * the registry, then driving the migration runner on the SAME
 * `@getcronit/pylon/db` instance the models registered into. We do this
 * in-process: bundle the models entry to a temp ESM file *inside the project*
 * (so its bare imports resolve against the project's node_modules), import it,
 * then resolve the project's pylon-orm and drive `MigrationRunner` from it.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import esbuild from 'esbuild'
import {isDestructive, type SchemaChange} from '../../ir'
import {spawnProjectRunner, type ProjectApp} from '../project-bridge.js'

let migrationCounter = 0

/**
 * Build a migration loader bound to the project root. Migration files are TS, so
 * the CLI transpiles them (esbuild) — keeping pylon-db transpiler-free. The temp
 * bundle is written *inside the project* (like the models-entry bridge) so its
 * external `@getcronit/pylon/db` import — and any models it touches — resolve to
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
    | 'seed'
    | 'baseline'
    | 'rename-app'
  /** Migration name (for `diff`; the target for `resolve`). */
  name?: string
  /** `diff`: which app to generate a migration for (required in apps mode). */
  app?: string
  /** `plan`: render down SQL instead of up. */
  down?: boolean
  /** `seed`: path to the seed file (default `./src/seed.ts`). */
  seed?: string
  /** `baseline`: where to write generated model stubs (default `./src/models.generated.ts`). */
  out?: string
  /** `diff`: confirmed renames (drop+add → renameColumn, data-preserving). */
  renames?: Array<{table: string; from: string; to: string}>
  /** `diff`: confirmed TABLE renames (drop+create → renameTable, data-preserving). */
  tableRenames?: Array<{from: string; to: string}>
  /** `rename-app`: re-point the ledger after an app was renamed (`<from>` → app). */
  renameApp?: {from: string; to: string}
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
  /** `diff`: possible TABLE renames not confirmed via --rename-table (data-loss warning). */
  tableRenameCandidates?: Array<{from: string; to: string}>
  applied?: string[]
  /** `rollback`: reversed migration names. */
  rolledBack?: string[]
  /** `resolve`: `{name, as}` recorded in the ledger. */
  resolved?: {name: string; as: 'applied' | 'rolled-back'}
  /** `rename-app`: `{from, to, rows}` — ledger rows re-pointed to the new app. */
  renamedApp?: {from: string; to: string; rows: number}
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
  /** `seed`: whether the seed file ran. */
  seeded?: boolean
  /** apps mode: per-app applied migrations (`migrate`/`deploy`). */
  apps?: Array<{app: string; applied: string[]}>
  /** apps mode: per-app status (`status`). */
  appsStatus?: Array<{app: string; pendingChanges: number; unapplied: string[]}>
  /** `baseline`: the bootstrap result — migration written + stubs file + table count. */
  baseline?: {migration: string | null; modelsFile: string; tables: number}
}

/**
 * Run a `pylon db` command. Executes in a CHILD process (the project runner) so it
 * drives the project's OWN `@getcronit/pylon/db` — one instance, real migration
 * files, real `import.meta`. The parent stays the UX layer: it gets the plain
 * `DbCommandResult` back and formats it (see the CLI actions). See
 * PROJECT_LOADER_DESIGN.md.
 */
export async function runDbCommand(options: DbCommandOptions): Promise<DbCommandResult> {
  const cwd = options.cwd ?? process.cwd()
  const entry = options.models ?? './src/index.ts'
  return spawnProjectRunner<DbCommandResult>(cwd, 'db', entry, [JSON.stringify({...options, cwd})])
}

/**
 * The command logic, driven against an already-resolved project ORM. Runs INSIDE
 * the child (via `project-runner`), where the models are registered and the ORM is
 * the project's own instance.
 */
export async function runDbCommandCore(
  orm: ProjectApp,
  options: DbCommandOptions
): Promise<DbCommandResult> {
  const cwd = options.cwd ?? process.cwd()
  const dir = path.resolve(cwd, options.dir ?? './migrations')

  const runner = new orm.MigrationRunner({dir})
  const loadMigrationFile = createMigrationLoader(cwd)

  // Apps mode: models tagged via `models.app(name)` are DERIVED into migration
  // groups from the registry (group + inferred deps). Each group's dir is
  // `<dir>/<name>`. The CLI then operates per-group, in dependency order.
  const derived = typeof orm.appGroups === 'function' ? orm.appGroups() : []
  const groups =
    derived.length > 0
      ? derived.map(g => {
          // Each app owns its migrations, colocated with its source (default
          // `<app-source-dir>/migrations`) — no central folder. `g.dir` is unset only
          // when core couldn't capture the app's source location; set it explicitly.
          if (!g.dir) {
            throw new Error(
              `App "${g.name}" migrations directory couldn't be determined. ` +
                `Set it explicitly:\n` +
                `  new Pylon({name: '${g.name}', db: {models: […], migrations: 'src/apps/${g.name}/migrations'}})`
            )
          }
          return {...g, dir: path.isAbsolute(g.dir) ? g.dir : path.resolve(cwd, g.dir)}
        })
      : null

  switch (options.command) {
    case 'status': {
      // Connect when a DB is available so status can read the applied-migrations
      // ledger and report `unapplied` accurately; without a DB it can only show
      // pending (uncaptured) changes and treats every migration as unapplied.
      const db = process.env.DATABASE_URL
        ? orm.connect({connectionString: process.env.DATABASE_URL})
        : undefined
      if (groups) {
        const res = await orm.statusGroups(groups, loadMigrationFile, db)
        const appsStatus = res.map(r => ({app: r.group, pendingChanges: r.pendingChanges, unapplied: r.unapplied}))
        const drift = db ? await orm.schemaDrift(db) : undefined
        return {command: 'status', appsStatus, drift}
      }
      const status = await runner.status(loadMigrationFile, db)
      const drift = db ? await orm.schemaDrift(db) : undefined
      return {command: 'status', status, drift}
    }
    case 'diff': {
      if (groups) {
        if (!options.app) {
          throw new Error(
            `This project uses apps — specify one: \`pylon db diff --app <name>\` ` +
              `(apps: ${groups.map(g => g.name).join(', ')}).`
          )
        }
        const group = groups.find(g => g.name === options.app)
        if (!group) throw new Error(`Unknown app "${options.app}".`)
        const made = await orm.generateGroup(group, options.name ?? 'migration', loadMigrationFile, {
          renames: options.renames,
          tableRenames: options.tableRenames
        })
        const groupDestructive = (made?.changes as SchemaChange[] | undefined)?.some(isDestructive)
        return {
          command: 'diff',
          created: made?.name ?? null,
          destructive: groupDestructive ?? false,
          renameCandidates: made?.renameCandidates ?? [],
          tableRenameCandidates: made?.tableRenameCandidates ?? []
        }
      }
      const created = await runner.generate(options.name ?? 'migration', loadMigrationFile, {
        renames: options.renames,
        tableRenames: options.tableRenames
      })
      const destructive = (created?.changes as SchemaChange[] | undefined)?.some(isDestructive)
      return {
        command: 'diff',
        created: created?.name ?? null,
        destructive: destructive ?? false,
        renameCandidates: created?.renameCandidates ?? [],
        tableRenameCandidates: created?.tableRenameCandidates ?? []
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
      if (groups) {
        const res = await orm.migrateGroups(groups, loadMigrationFile, conn)
        const apps = res.map(r => ({app: r.group, applied: r.applied}))
        return {command: 'migrate', apps, applied: apps.flatMap(a => a.applied)}
      }
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
    case 'rename-app': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db rename-app requires DATABASE_URL to be set.')
      }
      if (!options.renameApp) throw new Error('pylon db rename-app requires <old>=<new>.')
      const {from, to} = options.renameApp
      if (!groups) {
        throw new Error('pylon db rename-app only applies to an apps-based project.')
      }
      const conn = orm.connect({connectionString})
      const rows = await orm.renameGroupApp(groups, from, to, conn)
      return {command: 'rename-app', renamedApp: {from, to, rows}}
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
    case 'seed': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db seed requires DATABASE_URL to be set.')
      }
      const conn = orm.connect({connectionString})
      const seedPath = path.resolve(cwd, options.seed ?? './src/seed.ts')
      // The seed file `export default`s a function; it runs against the connected
      // database and may use the ORM (`Model.objects.*`) or the passed `db`.
      const seedFn = (await loadMigrationFile(seedPath)) as unknown
      if (typeof seedFn !== 'function') {
        throw new Error(`Seed file ${options.seed ?? './src/seed.ts'} must \`export default\` a function.`)
      }
      await (seedFn as (db: unknown) => Promise<void>)(conn)
      return {command: 'seed', seeded: true}
    }
    case 'deploy': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db deploy requires DATABASE_URL to be set.')
      }
      const conn = orm.connect({connectionString})
      if (groups) {
        // Per-group guard pass + dependency-ordered apply (handled by deployGroups).
        const res = await orm.deployGroups(groups, loadMigrationFile, conn)
        const apps = res.map(r => ({app: r.group, applied: r.applied}))
        return {command: 'deploy', apps, applied: apps.flatMap(a => a.applied)}
      }
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
    case 'baseline': {
      // Adopt an existing, un-migrated database: deep-introspect it, emit model
      // stubs, write an initial migration capturing the whole schema, and mark
      // that migration applied (the tables already exist, so it must not run).
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db baseline requires DATABASE_URL to be set.')
      }
      if (typeof orm.introspectPhysical !== 'function') {
        throw new Error(
          'This project\'s @getcronit/pylon/db is too old for `baseline` (no introspectPhysical).'
        )
      }
      const conn = orm.connect({connectionString})
      const schema = await orm.introspectPhysical(conn)
      const tables = Object.keys(schema).length
      if (tables === 0) {
        throw new Error('pylon db baseline: the database has no tables to adopt.')
      }

      // 1. Model stubs (a reviewable starting point).
      const outRel = options.out ?? './src/models.generated.ts'
      const outAbs = path.resolve(cwd, outRel)
      await fs.mkdir(path.dirname(outAbs), {recursive: true})
      await fs.writeFile(outAbs, orm.generateModelSource(schema))

      // 2. Initial migration + mark it applied so `migrate`/`deploy` skip it.
      const created = await runner.baseline(schema, options.name ?? 'baseline')
      if (created) {
        await runner.markApplied(created.name, loadMigrationFile, conn)
      }
      return {
        command: 'baseline',
        baseline: {migration: created?.name ?? null, modelsFile: outRel, tables}
      }
    }
  }
}
