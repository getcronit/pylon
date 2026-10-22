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
import {loadProjectApp, closeProjectApp, type ProjectApp} from '../project-bridge.js'

let migrationLoadSeq = 0

/**
 * Load a migration file into the project's module scope. A migration imports `@getcronit/pylon/db`
 * (and a data migration may pull in project models) by BARE specifier, which resolves only against the
 * project's own `node_modules` — but the migrations dir can live anywhere (a tmpdir in the e2e harness,
 * or outside the project), so importing the file from where it sits fails: Node's ESM resolver walks up
 * from the file and finds no `@getcronit/pylon`, and letting tsx transpile the `.ts` to CJS instead only
 * trades that for a `require(esm)` cycle (the ORM is mid-evaluation up the stack).
 *
 * So bundle it to ONE self-contained ESM file written into the project root (`cwd`): bare imports stay
 * external — resolving to the project's single ORM instance at import time, never a second copy — while
 * the migration's own code and any relative/project modules it touches are inlined. We `generate()` in
 * memory with `inlineDynamicImports` (one chunk) and write only that entry, so nothing can leak; an
 * earlier version wrote the whole bundle and its cleanup missed the code-split sidecars, piling
 * `rolldown-runtime-*.js` / `<name>-<hash>.js` into the repo. The temp file is `.mjs` (ESM, so an import
 * cycle through the ORM is legal via live bindings), dot-prefixed, and removed in `finally`.
 */
function createMigrationLoader(cwd: string) {
  return async function loadMigrationFile(filePath: string): Promise<unknown> {
    const stem = `.pylon-migration.${process.pid}.${migrationLoadSeq++}`
    const outFile = path.join(cwd, `${stem}.mjs`)
    // rolldown has no inline `tsconfigRaw`; write a temp tsconfig to FORCE
    // `useDefineForClassFields: false` so a data migration's model-field initializers run as
    // assignments the model proxy can harvest. `tsconfig` applies globally, so it holds even when
    // the migration lives in a tmpdir. The ORM is decorator-free.
    const tsconfig = path.join(cwd, `${stem}.tsconfig.json`)
    await fs.writeFile(tsconfig, JSON.stringify({compilerOptions: {useDefineForClassFields: false}}))
    try {
      const bundle = await rolldown({
        input: {[stem]: filePath},
        // Any bare import (@getcronit/pylon/db, npm packages) stays external so it resolves to the
        // PROJECT's instance at import time; relative/absolute project code is inlined.
        external: id => !id.startsWith('.') && !path.isAbsolute(id),
        platform: 'node',
        tsconfig
      })
      try {
        const {output} = await bundle.generate({format: 'esm', inlineDynamicImports: true})
        const entry = output.find(o => o.type === 'chunk' && o.isEntry)
        if (!entry || entry.type !== 'chunk') {
          throw new Error(`migration bundle produced no entry chunk for ${filePath}`)
        }
        await fs.writeFile(outFile, entry.code)
      } finally {
        await bundle.close()
      }
      const mod = (await import(/* @vite-ignore */ pathToFileURL(outFile).href)) as {default: unknown}
      return mod.default
    } finally {
      await fs.rm(outFile, {force: true})
      await fs.rm(tsconfig, {force: true})
    }
  }
}

type SchemaDrift = {
  missingTables: string[]
  extraTables: string[]
  columns: Array<{table: string; missing: string[]; extra: string[]}>
  /** Columns/FKs/indexes present under the right name but the wrong shape. */
  mismatches?: string[]
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
    | 'fix-deps'
  /** Migration name (for `diff`; the target for `resolve`). */
  name?: string
  /** Which app to act on (required in apps mode): the app to generate a migration
   *  for (`diff`), or the app owning the `resolve`/`rollback` target migration. */
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
  /** `fix-deps`: write the backfilled tuples to disk (default: report only). */
  write?: boolean
  /** `push`: detect-only — return the destructive drift (orphan columns + rename candidates) and
   *  apply nothing, so the parent (TTY) can prompt before a second, applying call. */
  pushDetect?: boolean
  /** `push`: orphan columns to DROP (data loss), confirmed via `--force` or the interactive prompt. */
  dropColumns?: Array<{table: string; column: string}>
  /** `diff`: detect-only — compute rename candidates and write no migration, so the CLI can confirm
   *  renames interactively before the real generate pass. */
  detectOnly?: boolean
}

/** Migrations that reference a cross-app table but don't declare the `[app, migration]`
 *  edge for it — the hazard that breaks a from-scratch apply (`db reset`). */
export type MissingDepsReport = Array<{
  app: string
  migration: string
  file: string
  needs: Array<{table: string; app: string; migration: string}>
}>

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
  /** `diff`: valid SQL that will still fail on a table that already has rows. */
  warnings?: string[]
  /** apps mode `diff`: one entry per app that actually had changes. */
  diffs?: Array<{
    app: string
    created: string
    destructive: boolean
    renameCandidates: Array<{table: string; from: string; to: string}>
    tableRenameCandidates: Array<{from: string; to: string}>
    warnings: string[]
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
    /** Migrations missing a cross-app dependency edge (breaks a from-scratch apply). */
    missingDeps?: MissingDepsReport
  }
  /** `fix-deps`: the cross-app edges detected (dry-run) or backfilled (`--write`). */
  missingDeps?: MissingDepsReport
  status?: {pendingChanges: unknown[]; migrations: string[]; unapplied: string[]}
  /** `status`/`check`: live-DB drift (when a database is available). */
  drift?: SchemaDrift
  /** `push`: whether the schema was synced. */
  pushed?: boolean
  /** `push --detect`: the destructive drift a push would face (nothing was applied). */
  pushDrift?: {
    renameCandidates: Array<{table: string; from: string; to: string}>
    dropColumns: Array<{table: string; column: string}>
  }
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
 * Run a `pylon db` command. Loads the project IN-PROCESS (tsx loader + entry-scoped resolution) so it
 * drives the project's OWN `@getcronit/pylon/db` — one instance, real migration files, real
 * `import.meta` — then runs the command logic directly, no subprocess, no IPC, no temp file. The ORM
 * pool is closed afterwards so the CLI can exit; the loaded module stays cached, so a follow-up op in
 * the same invocation (e.g. push detect→apply) reuses the registered instance and reconnects.
 */
export async function runDbCommand(options: DbCommandOptions): Promise<DbCommandResult> {
  const cwd = options.cwd ?? process.cwd()
  const entry = options.models ?? './src/index.ts'
  const orm = await loadProjectApp(cwd, entry)
  try {
    return await runDbCommandCore(orm as unknown as ProjectApp, {...options, cwd})
  } finally {
    await closeProjectApp(orm)
  }
}

/**
 * The command logic, driven against an already-resolved project ORM (loaded in-process by
 * `loadProjectApp`), where the models are registered and the ORM is the project's own instance.
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
  const {database, created} = await orm.ensureDatabase(connectionString)
  return {name: database, created}
}

export async function runDbCommandCore(
  orm: ProjectApp,
  options: DbCommandOptions
): Promise<DbCommandResult> {
  const cwd = options.cwd ?? process.cwd()
  const dir = path.resolve(cwd, options.dir ?? './migrations')

  const loadMigrationFile = createMigrationLoader(cwd)

  // Apps mode: models tagged via `models.app(name)` are DERIVED into migration
  // groups from the registry (group + inferred deps). Each group's dir is
  // `<dir>/<name>`. The CLI then operates per-group, in dependency order.
  const derived = orm.appGroups()
  // Apps-only: there is ALWAYS at least one group. A project with `models.app()` tags
  // yields those groups; an untagged project is one implicit DEFAULT app — every model,
  // the root `./migrations` dir, a BARE ledger — so the whole CLI runs one uniform path.
  // A root-only result is flattened back to the pre-apps shape (`flattenRootResult`) so
  // its output and JSON are byte-identical to before.
  const groups: Array<Record<string, unknown> & {name: string; dir: string; root?: boolean}> =
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
      : [{name: 'default', root: true, dir, models: [], dependencies: []}]
  const rootOnly = groups.length === 1 && groups[0].root === true

  // A correctly-configured runner for one group (bare ledger for the default app).
  const groupRunnerOf = (group: (typeof groups)[number]) => orm.groupRunner(group)
  // The tail commands (rollback/squash/baseline/resolve/merge) act on ONE app's
  // history: the default app when a project has none composed, else the `--app`
  // selection (required, since the operation is per-app).
  const targetGroup = (): (typeof groups)[number] => {
    if (rootOnly) return groups[0]
    const g = options.app ? groups.find(x => x.name === options.app) : undefined
    if (!g) {
      throw new Error(
        `This is a multi-app project — pass --app <name> to choose which app to act on ` +
          `(apps: ${groups.map(x => x.name).join(', ')}).`
      )
    }
    return g
  }

  switch (options.command) {
    case 'status': {
      // Connect when a DB is available so status can read the applied-migrations
      // ledger and report `unapplied` accurately; without a DB it can only show
      // pending (uncaptured) changes and treats every migration as unapplied.
      const db = process.env.DATABASE_URL
        ? orm.connect({connectionString: process.env.DATABASE_URL})
        : undefined
      const drift = db ? await orm.schemaDrift(db) : undefined
      // A single default app reports flat, matching the pre-apps output.
      if (rootOnly) {
        const status = await groupRunnerOf(groups[0]).status(loadMigrationFile, db)
        return {command: 'status', status, drift}
      }
      const res = await orm.statusGroups(groups, loadMigrationFile, db)
      const appsStatus = res.map(r => ({
        app: r.group,
        pendingChanges: r.pendingChanges,
        pending: r.pending ?? [],
        unapplied: r.unapplied
      }))
      return {command: 'status', appsStatus, drift}
    }
    case 'diff': {
      // Default to EVERY app. Requiring `--app` made the common case ("I changed
      // some models, capture it") fail with a list to copy from, and left you
      // running the command once per app to find which ones actually drifted.
      // `--app` still narrows to one. Apps with no changes generate nothing.
      const targets = options.app
        ? [groups.find(g => g.name === options.app)]
        : orm.orderGroups(groups)
      if (options.app && !targets[0]) {
        throw new Error(
          `Unknown app "${options.app}" (apps: ${groups.map(g => g.name).join(', ')}).`
        )
      }
      // Detect-only: compute rename candidates across the target apps and write nothing, so the CLI
      // can confirm renames interactively, then re-run `diff` with the chosen `--rename` hints.
      if (options.detectOnly) {
        const rc: Array<{table: string; from: string; to: string}> = []
        const trc: Array<{from: string; to: string}> = []
        for (const group of targets as typeof groups) {
          const made = await orm.generateGroup(group, options.name ?? 'migration', loadMigrationFile, {
            renames: options.renames,
            tableRenames: options.tableRenames,
            castHints: options.castHints,
            siblings: groups,
            dryRun: true
          })
          if (made) {
            rc.push(...made.renameCandidates)
            trc.push(...made.tableRenameCandidates)
          }
        }
        return {command: 'diff', created: null, renameCandidates: rc, tableRenameCandidates: trc}
      }
      // Cross-app FK retypes first: emit the coordinated pre/retype/post migrations
      // across apps (throws on an unsatisfiable one-sided retype). The per-app pass
      // below then diffs against this updated baseline, so unrelated changes still land.
      const coordinated = await orm.generateCoordinatedRetype(
        groups,
        loadMigrationFile,
        options.name ?? 'migration'
      )
      const diffs: NonNullable<DbCommandResult['diffs']> = []
      if (coordinated?.length) {
        for (const m of coordinated) {
          const [app, created] = m.split(/:(.*)/)
          diffs.push({
            app,
            created,
            destructive: false,
            renameCandidates: [],
            tableRenameCandidates: [],
            warnings: []
          })
        }
      }
      for (const group of targets as typeof groups) {
        const made = await orm.generateGroup(group, options.name ?? 'migration', loadMigrationFile, {
          renames: options.renames,
          tableRenames: options.tableRenames,
          castHints: options.castHints,
          siblings: groups
        })
        if (!made) continue
        diffs.push({
          app: group.name,
          created: made.name,
          destructive: (made.changes as SchemaChange[] | undefined)?.some(isDestructive) ?? false,
          renameCandidates: made.renameCandidates ?? [],
          tableRenameCandidates: made.tableRenameCandidates ?? [],
          warnings: made.warnings ?? []
        })
      }
      // A single default app reports flat (no per-app `diffs`), so the CLI prints the
      // unprefixed "Created migration …" and its plain rename/destructive warnings.
      if (rootOnly) {
        const d = diffs[0]
        return {
          command: 'diff',
          created: d?.created ?? null,
          destructive: d?.destructive ?? false,
          renameCandidates: d?.renameCandidates ?? [],
          tableRenameCandidates: d?.tableRenameCandidates ?? [],
          warnings: d?.warnings ?? []
        }
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
    case 'plan': {
      const direction = options.down ? 'down' : 'up'
      // Plan each app in dependency order; a single (default) app prints unprefixed.
      const ordered = orm.orderGroups(groups)
      const plan: Array<{name: string; statements: string[]}> = []
      for (const group of ordered) {
        const steps = await new orm.MigrationRunner({dir: group.dir!}).plan(
          loadMigrationFile,
          direction
        )
        plan.push(
          ...steps.map(s => ({...s, name: rootOnly ? s.name : `${group.name}:${s.name}`}))
        )
      }
      return {command: 'plan', plan}
    }
    case 'check': {
      const db = process.env.DATABASE_URL
        ? orm.connect({connectionString: process.env.DATABASE_URL})
        : undefined
      const drift = db ? await orm.schemaDrift(db) : undefined
      // Each app owns its migrations dir; scope per group. A single (default) app
      // prints its details unprefixed, matching the pre-apps output.
      const res = await orm.statusGroups(groups, loadMigrationFile, db)
      const tampered = db ? await orm.integrityErrorsGroups(groups, loadMigrationFile, db) : []
      // Static, DB-free: a migration that references another app's table but doesn't
      // declare the edge applies fine incrementally yet breaks a from-scratch build.
      const missingDeps = await orm.detectMissingCrossAppDeps(groups, loadMigrationFile)
      return {
        command: 'check',
        check: {
          uncaptured: res.reduce((n, r) => n + r.pendingChanges, 0),
          uncapturedDetail: res.flatMap(r =>
            (r.pending ?? []).map(p => (rootOnly ? p : `${r.group}: ${p}`))
          ),
          tampered,
          unapplied: res.flatMap(r => r.unapplied.map(u => (rootOnly ? u : `${r.group}:${u}`))),
          drift,
          missingDeps: missingDeps.length ? missingDeps : undefined
        }
      }
    }
    case 'fix-deps': {
      const fn = options.write ? orm.fixMissingCrossAppDeps : orm.detectMissingCrossAppDeps
      const missingDeps = await fn(groups, loadMigrationFile)
      return {command: 'fix-deps', missingDeps}
    }
    case 'create': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db create requires DATABASE_URL to be set.')
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
      // Create the DB if it's missing, then drop it to a clean slate and re-apply.
      const created = await ensureDatabaseForDev(orm, connectionString)
      const conn = orm.connect({connectionString})
      await orm.resetSchema()
      const applied = (await orm.migrateGroups(groups, loadMigrationFile, conn)).flatMap(
        r => r.applied
      )
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
        const pending = (await orm.statusGroups(groups, loadMigrationFile, conn)).flatMap(r =>
          (r.pending ?? []).map(p => (rootOnly ? p : `${r.group}: ${p}`))
        )
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
      const res = await withCreateDbHint(() => orm.migrateGroups(groups, loadMigrationFile, conn))
      const after = await orm.statusGroups(groups, loadMigrationFile, conn)
      return {
        command: 'migrate',
        // A single default app reports flat (no per-app breakdown), matching the
        // pre-apps output; a multi-app project reports each app.
        ...(rootOnly ? {} : {apps: res.map(r => ({app: r.group, applied: r.applied}))}),
        applied: res.flatMap(r => r.applied),
        uncaptured: after.reduce((n, r) => n + r.pendingChanges, 0),
        uncapturedDetail: after.flatMap(r =>
          (r.pending ?? []).map(p => (rootOnly ? p : `${r.group}: ${p}`))
        ),
        database: created
      }
    }
    case 'rollback': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db rollback requires DATABASE_URL to be set.')
      }
      const conn = orm.connect({connectionString})
      // Scoped to one app when `--app` is given; otherwise reverse-interleaved across
      // ALL apps (the mirror of migrate), so a coordinated cross-app retype rolls back
      // as one cluster.
      if (options.app || rootOnly) {
        const rolledBack = await groupRunnerOf(targetGroup()).rollback(loadMigrationFile, conn, {
          steps: options.steps ?? 1
        })
        return {command: 'rollback', rolledBack}
      }
      const res = await orm.rollbackGroups(groups, loadMigrationFile, conn, {steps: options.steps})
      return {command: 'rollback', rolledBack: res.flatMap(r => r.applied)}
    }
    case 'resolve': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db resolve requires DATABASE_URL to be set.')
      }
      if (!options.name) throw new Error('pylon db resolve requires a migration name.')
      const as = options.resolve ?? 'applied'
      const conn = orm.connect({connectionString})
      const r = groupRunnerOf(targetGroup())
      if (as === 'applied') await r.markApplied(options.name, loadMigrationFile, conn)
      else await r.markRolledBack(options.name, conn)
      return {command: 'resolve', resolved: {name: options.name, as}}
    }
    case 'rename-app': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db rename-app requires DATABASE_URL to be set.')
      }
      if (!options.renameApp) throw new Error('pylon db rename-app requires <old>=<new>.')
      const {from, to} = options.renameApp
      if (rootOnly) {
        throw new Error(
          'pylon db rename-app applies to a project with multiple composed apps; a ' +
            'single-app project has no app to rename.'
        )
      }
      const conn = orm.connect({connectionString})
      const rows = await orm.renameGroupApp(groups, from, to, loadMigrationFile, conn)
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
      // Detect-only pass: report the destructive drift so the parent (TTY) can prompt, then re-run
      // this command with the confirmed renames/drops. Nothing is applied here.
      if (options.pushDetect) {
        const {renameCandidates, dropColumns} = await orm.pushPlan()
        return {command: 'push', pushed: false, pushDrift: {renameCandidates, dropColumns}, database: created}
      }
      // Apply pass: additive always; the destructive plan (renames / column drops) is whatever the
      // parent confirmed (empty = a plain additive push).
      await orm.syncSchema(undefined, {
        renames: options.renames,
        dropColumns: options.dropColumns
      })
      return {command: 'push', pushed: true, database: created}
    }
    case 'squash': {
      // Connect only if a DB is available, so the ledger can be reconciled.
      const conn = process.env.DATABASE_URL
        ? orm.connect({connectionString: process.env.DATABASE_URL})
        : undefined
      // Squash the chosen app's history and cascade-rewrite any sibling's cross-app
      // dependency tuples that named a now-collapsed migration to the squashed one.
      const squashed = await orm.squashGroups(
        groups,
        targetGroup().name,
        loadMigrationFile,
        options.name ?? 'squashed',
        conn
      )
      return {command: 'squash', squashed}
    }
    case 'merge': {
      const merged = await groupRunnerOf(targetGroup()).merge(
        loadMigrationFile,
        options.name ?? 'merge'
      )
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
      const baseRunner = groupRunnerOf(targetGroup())
      const created = await baseRunner.baseline(schema, options.name ?? 'baseline')
      if (created) {
        await baseRunner.markApplied(created.name, loadMigrationFile, conn)
      }
      return {
        command: 'baseline',
        baseline: {migration: created?.name ?? null, modelsFile: outRel, tables}
      }
    }
  }
}
