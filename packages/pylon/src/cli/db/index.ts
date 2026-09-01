/**
 * `pylon db` — schema migrations driven by the ORM's IR.
 *
 * The crux is loading the user's models so constructing their `new Pylon({db: {models}})`
 * populates the registry, then driving the migration runner on the SAME
 * `@getcronit/pylon/db` instance the models registered into. We do this
 * in-process: bundle the models entry to a temp ESM file *inside the project*
 * (so its bare imports resolve against the project's node_modules), import it,
 * then resolve the project's pylon-orm and drive `MigrationRunner` from it.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {rolldown} from 'rolldown'
import {describeChange, isDestructive, type SchemaChange} from '../../ir'
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
    const stem = path.join(cwd, `.pylon-migration.${process.pid}.${migrationCounter++}`)
    const tmp = `${stem}.mjs`
    // rolldown has no inline `tsconfigRaw`; write a temp tsconfig to FORCE
    // `useDefineForClassFields: false` (field-builder initializers must run as
    // assignments the model proxy can harvest). `tsconfig` applies globally, so it
    // works even when the migration file lives in a tmpdir. The ORM is decorator-free.
    const tsconfig = `${stem}.tsconfig.json`
    await fs.writeFile(
      tsconfig,
      JSON.stringify({
        compilerOptions: {useDefineForClassFields: false}
      })
    )
    try {
      const bundle = await rolldown({
        input: {[path.basename(stem)]: filePath},
        // packages:'external' equivalent — @getcronit/pylon/db (and any bare import)
        // stays external so it resolves to the PROJECT's instance at import time.
        external: id => !id.startsWith('.') && !path.isAbsolute(id),
        platform: 'node',
        tsconfig
      })
      await bundle.write({dir: cwd, format: 'esm', entryFileNames: `${path.basename(stem)}.mjs`})
      await bundle.close()
      const mod = (await import(/* @vite-ignore */ pathToFileURL(tmp).href)) as {default: unknown}
      return mod.default
    } finally {
      await fs.rm(tmp, {force: true})
      await fs.rm(tsconfig, {force: true})
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
    | 'create'
    | 'reset'
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
  /** `reset`: also run the seed file after re-applying migrations. */
  runSeed?: boolean
  /** `reset`: skip the production guard (confirmation is handled in the CLI layer). */
  force?: boolean
  /** `baseline`: where to write generated model stubs (default `./src/models.generated.ts`). */
  out?: string
  /** `diff`: confirmed renames (drop+add → renameColumn, data-preserving). */
  renames?: Array<{table: string; from: string; to: string}>
  /** `diff`: confirmed TABLE renames (drop+create → renameTable, data-preserving). */
  tableRenames?: Array<{from: string; to: string}>
  /** `diff`: `ALTER COLUMN … TYPE … USING` conversions for casts Postgres won't do itself. */
  castHints?: Array<{table: string; column: string; using?: string; usingDown?: string}>
  /** `rename-app`: re-point the ledger after an app was renamed (`<from>` → app). */
  renameApp?: {from: string; to: string}
  /** Entry that imports the models (default `./src/index.ts`). */
  models?: string
  /** Migrations directory (default `./migrations`). */
  dir?: string
  /** Project root (default `process.cwd()`). */
  cwd?: string
  /** `migrate`: create the database when it doesn't exist (dev convenience, opt-in). */
  createDb?: boolean
  /** `migrate`: refuse to apply while model changes are uncaptured (was `db deploy`). */
  check?: boolean
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
  /** apps mode `diff`: one entry per app that actually had changes. */
  diffs?: Array<{
    app: string
    created: string
    destructive: boolean
    renameCandidates: Array<{table: string; from: string; to: string}>
    tableRenameCandidates: Array<{from: string; to: string}>
  }>
  applied?: string[]
  /** `rollback`: reversed migration names. */
  rolledBack?: string[]
  /** `resolve`: `{name, as}` recorded in the ledger. */
  resolved?: {name: string; as: 'applied' | 'rolled-back'}
  /** `rename-app`: `{from, to, rows}` — ledger rows re-pointed to the new app. */
  renamedApp?: {from: string; to: string; rows: number}
  /** `plan`: per-migration SQL preview. */
  plan?: Array<{name: string; statements: string[]}>
  /** `check`: CI gate result. `uncapturedDetail` names each uncaptured change. */
  check?: {
    uncaptured: number
    uncapturedDetail?: string[]
    tampered: string[]
    unapplied: string[]
    drift?: SchemaDrift
  }
  status?: {pendingChanges: unknown[]; migrations: string[]; unapplied: string[]}
  /** `status`/`check`: live-DB drift (when a database is available). */
  drift?: SchemaDrift
  /** `push`: whether the schema was synced. */
  pushed?: boolean
  /** `create` (and dev auto-create on `push`/`migrate`): the target database and
   *  whether this run created it (false = it already existed). */
  database?: {name: string; created: boolean}
  /** `reset`: whether the schema was dropped/recreated + whether the seed ran. */
  reset?: {seeded: boolean}
  /** `squash`: the new migration name + the ones it replaced. */
  squashed?: {name: string; replaced: string[]} | null
  /** `merge`: the merge migration + the heads it reconverged (or null). */
  merged?: {name: string; heads: string[]} | null
  /** `seed`: whether the seed file ran. */
  seeded?: boolean
  /** `migrate`: model changes still not captured in a migration (a warning, not a gate). */
  uncaptured?: number
  uncapturedDetail?: string[]
  /** apps mode: per-app applied migrations (`migrate`/`deploy`). */
  apps?: Array<{app: string; applied: string[]}>
  /** apps mode: per-app status (`status`). */
  appsStatus?: Array<{app: string; pendingChanges: number; pending?: string[]; unapplied: string[]}>
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
/**
 * Dev-only "ensure the database exists" step for `push`/`migrate` (Prisma parity).
 * Returns `{name, created}` for the caller to surface, or `undefined` when the
 * project ORM predates `ensureDatabase` (older canary) — in which case we simply
 * fall through to the connect, preserving the prior "database does not exist" error.
 */
async function ensureDatabaseForDev(
  orm: ProjectApp,
  connectionString: string
): Promise<{name: string; created: boolean} | undefined> {
  if (typeof orm.ensureDatabase !== 'function') return undefined
  const {database, created} = await orm.ensureDatabase(connectionString)
  return {name: database, created}
}

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
        const appsStatus = res.map(r => ({
          app: r.group,
          pendingChanges: r.pendingChanges,
          pending: r.pending ?? [],
          unapplied: r.unapplied
        }))
        const drift = db ? await orm.schemaDrift(db) : undefined
        return {command: 'status', appsStatus, drift}
      }
      const status = await runner.status(loadMigrationFile, db)
      const drift = db ? await orm.schemaDrift(db) : undefined
      return {command: 'status', status, drift}
    }
    case 'diff': {
      if (groups) {
        // Default to EVERY app. Requiring `--app` made the common case ("I changed
        // some models, capture it") fail with a list to copy from, and left you
        // running the command once per app to find which ones actually drifted.
        // `--app` still narrows to one. Apps with no changes generate nothing.
        const targets = options.app
          ? [groups.find(g => g.name === options.app)]
          : typeof orm.orderGroups === 'function'
            ? orm.orderGroups(groups)
            : groups
        if (options.app && !targets[0]) {
          throw new Error(
            `Unknown app "${options.app}" (apps: ${groups.map(g => g.name).join(', ')}).`
          )
        }
        const diffs: NonNullable<DbCommandResult['diffs']> = []
        for (const group of targets as typeof groups) {
          const made = await orm.generateGroup(group, options.name ?? 'migration', loadMigrationFile, {
            renames: options.renames,
            tableRenames: options.tableRenames,
            castHints: options.castHints
          })
          if (!made) continue
          diffs.push({
            app: group.name,
            created: made.name,
            destructive: (made.changes as SchemaChange[] | undefined)?.some(isDestructive) ?? false,
            renameCandidates: made.renameCandidates ?? [],
            tableRenameCandidates: made.tableRenameCandidates ?? []
          })
        }
        return {
          command: 'diff',
          created: diffs.length === 1 ? diffs[0].created : null,
          destructive: diffs.some(d => d.destructive),
          diffs,
          renameCandidates: diffs.flatMap(d => d.renameCandidates),
          tableRenameCandidates: diffs.flatMap(d => d.tableRenameCandidates)
        }
      }
      const created = await runner.generate(options.name ?? 'migration', loadMigrationFile, {
        renames: options.renames,
        tableRenames: options.tableRenames,
        castHints: options.castHints
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
      const direction = options.down ? 'down' : 'up'
      // Apps mode: same scoping gap as `check` — the root dir holds no migrations,
      // so planning it prints nothing for a project that has plenty. Plan each app.
      if (groups) {
        const ordered = typeof orm.orderGroups === 'function' ? orm.orderGroups(groups) : groups
        const plan: Array<{name: string; statements: string[]}> = []
        for (const group of ordered) {
          const steps = await new orm.MigrationRunner({dir: group.dir!}).plan(
            loadMigrationFile,
            direction
          )
          plan.push(...steps.map(s => ({...s, name: `${group.name}:${s.name}`})))
        }
        return {command: 'plan', plan}
      }
      const plan = await runner.plan(loadMigrationFile, direction)
      return {command: 'plan', plan}
    }
    case 'check': {
      const db = process.env.DATABASE_URL
        ? orm.connect({connectionString: process.env.DATABASE_URL})
        : undefined
      const drift = db ? await orm.schemaDrift(db) : undefined
      // Apps mode: the migrations live in each app's own directory, so checking
      // the ROOT runner diffs an empty history against every model in the project
      // and reports the whole schema as uncaptured. Scope it per group, exactly
      // as `status`/`diff`/`migrate`/`deploy` do.
      if (groups) {
        const res = await orm.statusGroups(groups, loadMigrationFile, db)
        const tampered =
          db && typeof orm.integrityErrorsGroups === 'function'
            ? await orm.integrityErrorsGroups(groups, loadMigrationFile, db)
            : []
        return {
          command: 'check',
          check: {
            uncaptured: res.reduce((n, r) => n + r.pendingChanges, 0),
            uncapturedDetail: res.flatMap(r => (r.pending ?? []).map(p => `${r.group}: ${p}`)),
            tampered,
            unapplied: res.flatMap(r => r.unapplied.map(u => `${r.group}:${u}`)),
            drift
          }
        }
      }
      const status = await runner.status(loadMigrationFile, db)
      const tampered = db ? await runner.integrityErrors(loadMigrationFile, db) : []
      return {
        command: 'check',
        check: {
          uncaptured: status.pendingChanges.length,
          uncapturedDetail: (status.pendingChanges as SchemaChange[]).map(describeChange),
          tampered,
          unapplied: status.unapplied,
          drift
        }
      }
    }
    case 'create': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db create requires DATABASE_URL to be set.')
      }
      if (typeof orm.ensureDatabase !== 'function') {
        throw new Error(
          'This project’s @getcronit/pylon is too old to support `pylon db create`. Upgrade it.'
        )
      }
      const database = await orm.ensureDatabase(connectionString)
      return {command: 'create', database: {name: database.database, created: database.created}}
    }
    case 'reset': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db reset requires DATABASE_URL to be set.')
      }
      if (process.env.NODE_ENV === 'production' && !options.force) {
        throw new Error(
          'Refusing to reset the database in production. `pylon db reset` is destructive ' +
            '(drops every table and re-applies migrations). Pass --force only if you truly mean it.'
        )
      }
      if (typeof orm.resetSchema !== 'function') {
        throw new Error(
          'This project’s @getcronit/pylon is too old to support `pylon db reset`. Upgrade it.'
        )
      }
      // Create the DB if it's missing, then drop it to a clean slate and re-apply.
      const created = await ensureDatabaseForDev(orm, connectionString)
      const conn = orm.connect({connectionString})
      await orm.resetSchema()
      const applied = groups
        ? (await orm.migrateGroups(groups, loadMigrationFile, conn)).flatMap(r => r.applied)
        : await runner.apply(loadMigrationFile, conn)
      let seeded = false
      if (options.runSeed) {
        const seedPath = path.resolve(cwd, options.seed ?? './src/seed.ts')
        const seedFn = (await loadMigrationFile(seedPath)) as unknown
        if (typeof seedFn !== 'function') {
          throw new Error(`Seed file ${options.seed ?? './src/seed.ts'} must \`export default\` a function.`)
        }
        await (seedFn as (db: unknown) => Promise<void>)(conn)
        seeded = true
      }
      return {command: 'reset', applied, database: created, reset: {seeded}}
    }
    case 'migrate': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db migrate requires DATABASE_URL to be set.')
      }
      // Creating the database is OPT-IN (`--create-db`). It used to happen
      // implicitly, which is fine on a fresh checkout and awful in production: a
      // typo'd DATABASE_URL would silently create an empty database, migrate it
      // "successfully", and leave the app pointed at nothing.
      const created = options.createDb
        ? await ensureDatabaseForDev(orm, connectionString)
        : undefined
      const conn = orm.connect({connectionString})
      // Postgres 3D000 = invalid_catalog_name. Without --create-db that's now the
      // expected outcome on a fresh checkout, so say what to do about it rather
      // than surfacing the driver's bare "database ... does not exist".
      const withCreateDbHint = async <T>(fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn()
        } catch (e) {
          if ((e as {code?: string}).code === '3D000' && !options.createDb) {
            throw new Error(
              `${(e as Error).message}\n` +
                `Run \`pylon db migrate --create-db\` to create it (development only — in ` +
                `production the database should already exist, and a missing one usually ` +
                `means DATABASE_URL is wrong).`
            )
          }
          throw e
        }
      }

      // `--check` turns uncaptured model changes into a refusal, BEFORE applying
      // anything — for deploy pipelines that want the gate at the point of apply
      // rather than relying on `pylon db check` having run in CI.
      if (options.check) {
        const pending = groups
          ? (await orm.statusGroups(groups, loadMigrationFile, conn)).flatMap(r =>
              (r.pending ?? []).map(p => `${r.group}: ${p}`)
            )
          : (
              (await runner.status(loadMigrationFile, conn)).pendingChanges as SchemaChange[]
            ).map(describeChange)
        if (pending.length > 0) {
          throw new Error(
            `Refusing to migrate: ${pending.length} model change(s) are not captured in ` +
              `any migration — run \`pylon db diff\` and commit the result:\n` +
              pending.map(p => `  - ${p}`).join('\n')
          )
        }
      }
      // Otherwise report — after applying — whether the MODELS are still ahead of
      // the migration files. A warning, not a refusal: uncaptured changes leave the
      // database consistent with the recorded history (incomplete, not wrong), and
      // blocking would break the ordinary case of applying a teammate's migrations
      // while your own edits are in progress. The hard gate is `pylon db check` in
      // CI, or `--check` above. (A TAMPERED history is refused either way — that
      // check lives inside `apply` itself.)
      if (groups) {
        const res = await withCreateDbHint(() =>
          orm.migrateGroups(groups, loadMigrationFile, conn)
        )
        const apps = res.map(r => ({app: r.group, applied: r.applied}))
        const after = await orm.statusGroups(groups, loadMigrationFile, conn)
        return {
          command: 'migrate',
          apps,
          applied: apps.flatMap(a => a.applied),
          uncaptured: after.reduce((n, r) => n + r.pendingChanges, 0),
          uncapturedDetail: after.flatMap(r => (r.pending ?? []).map(p => `${r.group}: ${p}`)),
          database: created
        }
      }
      const applied = await withCreateDbHint(() => runner.apply(loadMigrationFile, conn))
      const after = await runner.status(loadMigrationFile, conn)
      return {
        command: 'migrate',
        applied,
        uncaptured: after.pendingChanges.length,
        uncapturedDetail: (after.pendingChanges as SchemaChange[]).map(describeChange),
        database: created
      }
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
      // Dev convenience (Prisma-parity, like `prisma db push`): create the database
      // if missing before syncing the schema into it.
      const created = await ensureDatabaseForDev(orm, connectionString)
      orm.connect({connectionString})
      await orm.syncSchema()
      return {command: 'push', pushed: true, database: created}
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
