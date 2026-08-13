import {program} from 'commander'

import {spawn, type ChildProcess} from 'child_process'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import chokidar from 'chokidar'
import consola from 'consola'
import dotenv from 'dotenv'
import {version} from '../../package.json'
import {
  analytics,
  dependencies,
  distinctId,
  readPylonConfig,
  sessionId
} from './analytics'
import {build} from './builder'
import {appModelToDDL, appModelToSDL, inspectApp} from './inspect'
import {verifyApp} from './verify'
import {startMcpServer} from './mcp'
import {runEval, formatReport, SdkRunner} from './eval'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {buildClient} from './builder/build-client'
import {startDevReloadServer} from './builder/dev-reload-server'
import {runDbCommand} from './db'
import {generatePylonTypes} from './pull'
import {treeKillSync} from './tree-kill'

dotenv.config()

const requireFromHere = createRequire(import.meta.url)

/**
 * Absolute path to tsx's CLI, resolved from pylon-dev's OWN deps so the user project needs
 * nothing installed. tsx (esbuild) transpiles `src/**` on-import honouring the project
 * tsconfig (`useDefineForClassFields:false`), and Node's module cache gives one instance
 * per file (no bundling, no duplication).
 */
/**
 * Run `entry` with the tsx loader IN-PROCESS — the exact hooks `tsx <file>` injects
 * (`--require preflight.cjs --import loader.mjs`), but WITHOUT going through the tsx
 * CLI. The CLI forks a SECOND node process that owns the listening socket; that
 * grandchild escapes both Ctrl-C and the dev restart's tree-kill (reparented /
 * separate group), leaving the port held → `EADDRINUSE` on the next rebuild and an
 * un-killable server. One process = one killable listener.
 */
function tsxRun(entry: string): string {
  const dir = path.dirname(requireFromHere.resolve('tsx/package.json'))
  const preflight = path.join(dir, 'dist', 'preflight.cjs')
  const loader = pathToFileURL(path.join(dir, 'dist', 'loader.mjs')).href
  return `node --require ${preflight} --import ${loader} ${entry}`
}

/** Default dev runner: the loader on the generated bootstrap. Override with `-c`. */
function defaultDevCommand(outputDir = '.pylon'): string {
  return tsxRun(`${outputDir}/server.mjs`)
}

/** Default worker runner: the loader on the worker entry (unbundled). Override with `-c`
 *  (e.g. prod: `node .pylon/src/worker.js` after `pylon build`). */
function defaultWorkerCommand(entry: string): string {
  return tsxRun(entry)
}

/** The app entry that, when imported, constructs your `Pylon` and registers its models. */
const ENTRY_DEFAULT = './src/index.ts'
/** Resolve the entry: `--entry`, else the deprecated `--models` alias, else the default. */
const entryOf = (o: {entry?: string; models?: string}): string =>
  o.entry ?? o.models ?? ENTRY_DEFAULT

program.name('pylon-dev').description('Pylon Development CLI').version(version)

program
  .command('build')
  .description('Build the Pylon Schema')
  .action(async () => {
    const ctx = await build({
      sfiFilePath: './src/index.ts',
      outputFilePath: './.pylon',
      mode: 'build'
    })

    const cleanupAndExit = async () => {
      await ctx.dispose().catch(() => {})
      process.exit(0)
    }
    process.on('SIGINT', cleanupAndExit)
    process.on('SIGTERM', cleanupAndExit)
    process.on('SIGHUP', cleanupAndExit)

    try {
      // Ordered: server bundle (→ schema) → gqty client (← schema) → page bundles
      // (→ manifests, importing the client). The sequence is the fix for the dev
      // ordering bug; one-shot build runs the same order.
      const out = await ctx.buildServer()
      await buildClient({schemaChanged: out?.schemaChanged ?? true})
      await ctx.buildPages()

      analytics.capture({
        distinctId,
        event: 'build completed',
        properties: {
          duration: out?.duration ?? 0,
          totalFiles: out?.totalFiles ?? 0,
          totalSize: out?.totalSize ?? 0,
          schemaChanged: out?.schemaChanged ?? true,
          dependencies,
          isDevelopment: false,
          $session_id: sessionId
        }
      })
    } finally {
      await ctx.dispose().catch(() => {})
    }
  })

program
  .command('inspect')
  .description('Serialize the app model (schema + entities + queues + authz)')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('--json', 'Emit the full AppModel as JSON (default)')
  .option('--sdl', 'Emit the GraphQL schema (SDL)')
  .option('--ddl', 'Emit the Postgres DDL')
  .action(async (options: {entry?: string; models?: string; json?: boolean; sdl?: boolean; ddl?: boolean}) => {
    const model = await inspectApp(process.cwd(), entryOf(options))
    if (options.sdl) {
      process.stdout.write(appModelToSDL(model) + '\n')
    } else if (options.ddl) {
      process.stdout.write(appModelToDDL(model) + '\n')
    } else {
      // Default + explicit --json: machine-readable AppModel on stdout.
      process.stdout.write(JSON.stringify(model, null, 2) + '\n')
    }
  })

program
  .command('verify')
  .description('Build + typecheck + migration check → a stratified verdict (pass/review/fail)')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('--json', 'Emit the verdict as JSON')
  .action(async (options: {entry?: string; models?: string; json?: boolean}) => {
    const result = await verifyApp(process.cwd(), entryOf(options))
    if (options.json) {
      // Lean payload for agents — verdict + checks (the AppModel is a separate call).
      process.stdout.write(JSON.stringify({verdict: result.verdict, checks: result.checks}, null, 2) + '\n')
    } else {
      const mark = (s: string) =>
        s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'warn' ? '!' : '·'
      for (const c of result.checks)
        process.stdout.write(`  ${mark(c.status)} ${c.name}: ${c.detail}\n`)
      process.stdout.write(`\nverdict: ${result.verdict.toUpperCase()}\n`)
    }
    process.exitCode = result.verdict === 'fail' ? 1 : 0
  })

program
  .command('mcp')
  .description('Run the Pylon MCP server (stdio): describe_app / get_entity / get_operation / verify')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-c, --cwd <dir>', 'Project root to inspect (default: current directory)', '.')
  .action(async (options: {entry?: string; models?: string; cwd: string}) => {
    // Directory-independent: resolve the target root so an MCP client config never
    // has to depend on the launch cwd. The spawned inspect/verify run with this root.
    const root = path.resolve(process.cwd(), options.cwd)
    // stdout is the MCP protocol stream from here on — do not write to it.
    await startMcpServer(root, entryOf(options))
  })

program
  .command('eval')
  .description('A/B usefulness harness: run an agent on tasks WITH vs WITHOUT the Pylon MCP')
  .option('-b, --bench <dir>', 'Bench dir (subfolders with scenario.json)', './bench')
  .option('--json', 'Emit the full report as JSON')
  .option('--keep', 'Keep run workdirs (under .eval-runs) for debugging')
  .option('--model <id>', 'Model the agent should use')
  .option('--max-turns <n>', 'Max agent turns per task', '30')
  .action(async (options: {bench: string; json?: boolean; keep?: boolean; model?: string; maxTurns: string}) => {
    const cliPath = fileURLToPath(import.meta.url) // bundled → dist/index.js
    const report = await runEval({
      benchDir: path.resolve(process.cwd(), options.bench),
      cliPath,
      runner: new SdkRunner({model: options.model, maxTurns: Number(options.maxTurns)}),
      keep: options.keep,
      onProgress: m => process.stderr.write(m + '\n')
    })
    // Always persist the full report (incl. per-row tool-call names) for offline
    // analysis of HOW each arm worked — without paying for another run.
    const reportPath = path.resolve(process.cwd(), 'eval-report.json')
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    else process.stdout.write(formatReport(report) + `\n\nfull report → ${reportPath}\n`)
  })

program
  .command('pull')
  .description(
    'Fetch a remote GraphQL API and generate strictly-typed Pylon Gateway models.'
  )
  .argument('<url>', 'The remote GraphQL endpoint URL')
  .option(
    '-n, --name <name>',
    'The name of the remote service (used for the generated filename)',
    'remote'
  )
  .option(
    '-o, --output <dir>',
    'The directory to output the generated types',
    './src/generated'
  )
  .action(async (url: string, options: {name: string; output: string}) => {
    try {
      // Constructs the full path, e.g., ./src/generated/remote.ts or ./src/generated/shopify.ts
      const finalPath = `${options.output}/${options.name}.ts`

      consola.start(`Pulling ${options.name} schema from ${url}...`)

      await generatePylonTypes(url, finalPath)

      consola.success(`Remote types generated successfully at ${finalPath}`)
    } catch (error) {
      consola.error(`Failed to pull ${options.name} remote schema:`, error)
      process.exit(1)
    }
  })

const db = program
  .command('db')
  .description('Manage the database schema (ORM migrations)')

db.command('status')
  .description('Show pending schema changes and unapplied migrations')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async options => {
    try {
      const {status, appsStatus, drift} = await runDbCommand({
        command: 'status',
        models: entryOf(options),
        dir: options.dir
      })
      if (appsStatus) {
        for (const a of appsStatus)
          consola.info(
            `app ${a.app}: ${a.pendingChanges} uncaptured change(s), ${a.unapplied.length} unapplied`
          )
      } else {
        const pending = status!.pendingChanges.length
        consola.info(
          `Uncaptured schema changes: ${pending}\n` +
            `Migrations: ${status!.migrations.length} (${status!.unapplied.length} unapplied)`
        )
      }
      if (drift) {
        const driftN =
          drift.missingTables.length + drift.extraTables.length + drift.columns.length
        if (driftN === 0) consola.info('Database in sync with migrations (no drift)')
        else {
          consola.warn('Database drift detected:')
          for (const t of drift.missingTables) consola.warn(`  missing table: ${t}`)
          for (const t of drift.extraTables) consola.warn(`  extra table (not in models): ${t}`)
          for (const c of drift.columns)
            consola.warn(
              `  ${c.table}: ${c.missing.map(x => `-${x}`).concat(c.extra.map(x => `+${x}`)).join(' ')}`
            )
        }
      }
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('diff')
  .description('Generate a migration from the diff between models and the migration history')
  .argument('[name]', 'Migration name', 'migration')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('-a, --app <name>', 'Generate for a specific app (apps mode)')
  .option(
    '--rename <spec...>',
    'Treat a drop+add column as a rename, e.g. --rename table.old=table.new'
  )
  .option(
    '--rename-table <spec...>',
    'Treat a drop+create table as a rename, e.g. --rename-table Old=New (model names)'
  )
  .action(async (name, options) => {
    try {
      const renames = ((options.rename as string[]) ?? []).map(spec => {
        const [left, right] = spec.split('=')
        const [table, from] = (left ?? '').split('.')
        const to = (right ?? '').split('.')[1] ?? (right ?? '')
        if (!table || !from || !to)
          throw new Error(`Invalid --rename "${spec}" (expected table.old=table.new)`)
        return {table, from, to}
      })
      const tableRenames = ((options.renameTable as string[]) ?? []).map(spec => {
        const [from, to] = spec.split('=')
        if (!from || !to)
          throw new Error(`Invalid --rename-table "${spec}" (expected Old=New)`)
        return {from, to}
      })
      const {created, destructive, renameCandidates, tableRenameCandidates} = await runDbCommand({
        command: 'diff',
        name,
        app: options.app,
        models: entryOf(options),
        dir: options.dir,
        renames,
        tableRenames
      })
      if (created) {
        consola.success(`Created migration ${created}`)
        for (const r of tableRenameCandidates ?? [])
          consola.warn(
            `Possible table rename ${r.from} → ${r.to} was emitted as drop+create ` +
              `(destroys the table's data). If it's a rename, regenerate with ` +
              `--rename-table ${r.from}=${r.to}`
          )
        for (const r of renameCandidates ?? [])
          consola.warn(
            `Possible rename ${r.table}.${r.from} → ${r.table}.${r.to} was emitted as ` +
              `drop+add (destroys data). If it's a rename, regenerate with ` +
              `--rename ${r.table}.${r.from}=${r.table}.${r.to}`
          )
        if (destructive)
          consola.warn('This migration drops a table or column — it will destroy data.')
      } else consola.info('No schema changes — nothing to generate')
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('plan')
  .description('Print the SQL each migration would run, without touching a database')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('--down', 'Show the down (reverse) SQL')
  .action(async options => {
    try {
      const {plan} = await runDbCommand({
        command: 'plan',
        models: entryOf(options),
        dir: options.dir,
        down: options.down
      })
      if (!plan || plan.length === 0) {
        consola.info('No migrations.')
        return
      }
      for (const {name, statements} of plan) {
        consola.log(`\n-- ${name}`)
        for (const stmt of statements) consola.log(`${stmt};`)
      }
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('check')
  .description('CI gate: fail on uncaptured model changes or tampered migrations')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async options => {
    try {
      const {check} = await runDbCommand({
        command: 'check',
        models: entryOf(options),
        dir: options.dir
      })
      const problems: string[] = []
      if (check!.uncaptured > 0)
        problems.push(`${check!.uncaptured} uncaptured model change(s) — run \`pylon db diff\``)
      if (check!.tampered.length > 0)
        problems.push(`tampered migration(s): ${check!.tampered.join(', ')}`)
      const d = check!.drift
      // Only MISSING schema fails CI (migrations not applied / DB behind). Extra
      // tables/columns are reported by `status` but don't fail — a shared DB can
      // legitimately hold other apps' tables, extensions, etc.
      const missing = d
        ? d.missingTables.length + d.columns.reduce((n, c) => n + c.missing.length, 0)
        : 0
      if (missing > 0) problems.push(`database missing ${missing} expected table(s)/column(s)`)
      if (problems.length > 0) {
        for (const p of problems) consola.error(p)
        process.exit(1)
      }
      consola.success(
        `Up to date${check!.unapplied.length ? ` (${check!.unapplied.length} unapplied)` : ''}.`
      )
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('migrate')
  .description('Apply unapplied migrations to the database (requires DATABASE_URL)')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async options => {
    try {
      const {applied, apps} = await runDbCommand({
        command: 'migrate',
        models: entryOf(options),
        dir: options.dir
      })
      if (apps) {
        for (const a of apps)
          consola.success(`app ${a.app}: applied ${a.applied.length} migration(s)`)
        if (apps.every(a => a.applied.length === 0)) consola.info('All apps up to date')
      } else if (applied && applied.length > 0)
        consola.success(`Applied ${applied.length} migration(s): ${applied.join(', ')}`)
      else consola.info('Database is up to date')
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('rollback')
  .description('Reverse the most recently applied migration(s) (requires DATABASE_URL)')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('-s, --steps <n>', 'How many migrations to reverse', '1')
  .action(async options => {
    try {
      const {rolledBack} = await runDbCommand({
        command: 'rollback',
        models: entryOf(options),
        dir: options.dir,
        steps: Number.parseInt(options.steps, 10)
      })
      if (rolledBack && rolledBack.length > 0)
        consola.success(`Rolled back ${rolledBack.length} migration(s): ${rolledBack.join(', ')}`)
      else consola.info('No applied migrations to roll back')
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('resolve')
  .description('Mark a migration applied/rolled-back in the ledger without running it')
  .argument('<name>', 'Migration name')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('--rolled-back', 'Mark as rolled-back (default: applied)')
  .action(async (name, options) => {
    try {
      const {resolved} = await runDbCommand({
        command: 'resolve',
        name,
        models: entryOf(options),
        dir: options.dir,
        resolve: options.rolledBack ? 'rolled-back' : 'applied'
      })
      consola.success(`Marked ${resolved!.name} as ${resolved!.as}`)
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('rename-app')
  .description(
    'Re-point the migration ledger after renaming an app (run once per DB before migrate)'
  )
  .argument('<spec>', 'oldApp=newApp (the app was renamed in code from oldApp to newApp)')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async (spec, options) => {
    try {
      const eq = String(spec).indexOf('=')
      const from = eq > 0 ? spec.slice(0, eq).trim() : ''
      const to = eq > 0 ? spec.slice(eq + 1).trim() : ''
      if (!from || !to) throw new Error(`Invalid spec "${spec}" (expected oldApp=newApp)`)
      const {renamedApp} = await runDbCommand({
        command: 'rename-app',
        renameApp: {from, to},
        models: entryOf(options),
        dir: options.dir
      })
      consola.success(
        `Re-pointed ${renamedApp!.rows} ledger row(s) from "${renamedApp!.from}:" to "${renamedApp!.to}:". Run \`pylon db migrate\` next.`
      )
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('seed')
  .description('Run the seed file to populate the database (requires DATABASE_URL)')
  .option('-s, --seed <path>', 'Seed file (default exports a function)', './src/seed.ts')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory (unused)', './migrations')
  .action(async options => {
    try {
      await runDbCommand({command: 'seed', seed: options.seed, models: entryOf(options)})
      consola.success('Seed complete')
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('baseline')
  .description(
    'Adopt an existing database: introspect it, generate model stubs + an initial migration, and mark it applied (requires DATABASE_URL)'
  )
  .argument('[name]', 'Name for the initial migration', 'baseline')
  .option('-e, --entry <path>', 'Entry that imports @getcronit/pylon/db (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('-o, --out <path>', 'Where to write generated model stubs', './src/models.generated.ts')
  .action(async (name, options) => {
    try {
      const {baseline} = await runDbCommand({
        command: 'baseline',
        name,
        models: entryOf(options),
        dir: options.dir,
        out: options.out
      })
      if (!baseline) {
        consola.info('Nothing to baseline')
        return
      }
      consola.success(
        `Baselined ${baseline.tables} table(s): models → ${baseline.modelsFile}` +
          (baseline.migration ? `, migration ${baseline.migration} (marked applied)` : '')
      )
      consola.info('Review the generated models before committing.')
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('merge')
  .description('Reconverge divergent migration heads (after a branch merge) into a merge migration')
  .argument('[name]', 'Name for the merge migration', 'merge')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async (name, options) => {
    try {
      const {merged} = await runDbCommand({
        command: 'merge',
        name,
        models: entryOf(options),
        dir: options.dir
      })
      if (!merged) consola.info('No divergent heads — nothing to merge')
      else consola.success(`Merged heads [${merged.heads.join(', ')}] into ${merged.name}`)
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('squash')
  .description('Collapse the schema migration history into a single migration (rewrites history)')
  .argument('[name]', 'Name for the squashed migration', 'squashed')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async (name, options) => {
    try {
      const {squashed} = await runDbCommand({
        command: 'squash',
        name,
        models: entryOf(options),
        dir: options.dir
      })
      if (!squashed) consola.info('No migrations to squash')
      else
        consola.success(
          `Squashed ${squashed.replaced.length} migration(s) into ${squashed.name}`
        )
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('deploy')
  .description('Apply pending migrations for production (refuses on uncaptured changes / tampering)')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async options => {
    try {
      const {applied, apps} = await runDbCommand({
        command: 'deploy',
        models: entryOf(options),
        dir: options.dir
      })
      if (apps) {
        const total = apps.reduce((n, a) => n + a.applied.length, 0)
        if (total > 0)
          for (const a of apps.filter(a => a.applied.length))
            consola.success(`app ${a.app}: deployed ${a.applied.length} migration(s)`)
        else consola.info('All apps up to date')
      } else if (applied && applied.length > 0)
        consola.success(`Deployed ${applied.length} migration(s): ${applied.join(', ')}`)
      else consola.info('Database is up to date')
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('push')
  .description('Sync models to the database directly, without a migration (prototyping)')
  .option('-e, --entry <path>', 'Entry that constructs your app / registers models (default ./src/index.ts)')
  .option('-m, --models <path>', 'Deprecated alias for --entry')
  .option('-d, --dir <path>', 'Migrations directory (unused)', './migrations')
  .action(async options => {
    try {
      await runDbCommand({command: 'push', models: entryOf(options)})
      consola.success('Schema pushed to the database')
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

program
  .command('dev')
  .description('Start the Pylon Development Server')
  .option(
    '-c, --command <command>',
    'Command to run the server (default: node + the tsx loader on .pylon/server.mjs)'
  )
  .action(async options => {
    // Default runner: the tsx loader on the generated bootstrap (unbundled server).
    const command: string = options.command ?? defaultDevCommand()
    let serverProcess: ChildProcess | null = null
    // `killing` distinguishes our intentional kill from a real crash (read by the
    // child's `exit` handler).
    let killing = false

    // Kill the server AND await its actual exit — so the next spawn can't race the
    // old process for the port (EADDRINUSE / orphan). Falls back after a timeout if
    // `exit` never arrives.
    const killServer = () =>
      new Promise<void>(resolve => {
        const proc = serverProcess
        if (!proc || !proc.pid) return resolve()
        serverProcess = null
        killing = true
        let done = false
        const finish = () => {
          if (done) return
          done = true
          resolve()
        }
        proc.once('exit', finish)
        try {
          // SIGKILL (not the default SIGTERM): a dev restart wants the port freed
          // NOW — no graceful-shutdown handler can delay the exit and race the
          // next spawn for the port.
          treeKillSync(proc.pid, 'SIGKILL')
        } catch (e: any) {
          consola.error('Failed to kill server process', e)
          finish()
        }
        setTimeout(finish, 4000).unref?.()
      })

    const restartServer = async () => {
      await killServer()
      serverProcess = startDevServer(command, (code, signal) => {
        if (killing) {
          killing = false // our intentional restart — not a crash
          return
        }
        if (code && code !== 0) {
          consola.error(
            `[Pylon] Dev server exited (code ${code}). Fix the error and save to restart.`
          )
        } else if (signal) {
          consola.warn(`[Pylon] Dev server terminated (${signal}).`)
        }
      })
    }

    // Tier-0 live-reload: an SSE server on the stable CLI process. Start it BEFORE
    // the first build so the pages bundle injects its URL (via PYLON_DEV_RELOAD_PORT).
    // Port = app PORT + 1, stepping up to the next free port if taken.
    const appPort = Number(process.env.PORT) || 3000
    const reload = await startDevReloadServer(appPort + 1)
    process.env.PYLON_DEV_RELOAD_PORT = String(reload.port)
    consola.info(
      `[Pylon] Live-reload server on http://localhost:${reload.port} (browser auto-reloads on rebuild)`
    )

    // build() throws loudly on a config/init failure → exits non-zero (fail-loud).
    const ctx = await build({
      sfiFilePath: './src/index.ts',
      outputFilePath: './.pylon',
      mode: 'dev'
    })

    // The ordered, single-flight sequence (the Supervisor). On every change:
    //   server bundle (→ schema) → gqty client (← schema) → page bundles
    //   (→ manifests, importing the client) → restart the server.
    // A newer change supersedes an in-flight run (gen guard); the chain serializes
    // so restarts never overlap. A failed build logs and leaves the last-good
    // server running (no restart, no crash-loop).
    let gen = 0
    let chain: Promise<void> = Promise.resolve()
    const sync = () => {
      const g = ++gen
      chain = chain
        .then(async () => {
          if (g !== gen) return
          const out = await ctx.buildServer()
          if (g !== gen) return
          // Regenerate the gqty client only when the schema changed (else the
          // existing .pylon/client is reused — page bundles import it).
          if (out?.schemaChanged ?? true) await buildClient({schemaChanged: true})
          if (g !== gen) return
          await ctx.buildPages()
          if (g !== gen) return
          await restartServer()
          // Once the freshly-restarted server is actually listening, push a reload
          // to every connected browser (guarded so a superseding build wins).
          if (g === gen) {
            await waitForAppReady(appPort)
            if (g === gen) reload.notify()
          }
          analytics.capture({
            distinctId,
            event: 'build completed',
            properties: {
              duration: out?.duration ?? 0,
              totalFiles: out?.totalFiles ?? 0,
              totalSize: out?.totalSize ?? 0,
              schemaChanged: out?.schemaChanged ?? true,
              dependencies,
              pylonConfig: await readPylonConfig(),
              isDevelopment: true,
              $session_id: sessionId
            }
          })
        })
        .catch(e => consola.error('[Pylon] Build failed:', e))
      return chain
    }

    await sync() // initial build + serve

    // Watch the WHOLE project (minus deps / build output / vcs) → re-run the
    // sequence (coalesced/single-flight). Watching only src/pages/public missed a
    // component imported by a page from anywhere else (e.g. `components/`, `lib/`):
    // it's in the build's import graph but no save event fired, so it never rebuilt.
    // Watching cwd catches any imported source wherever it lives.
    //
    // ABSOLUTE path (no `cwd` option): under cwd-relative matching, chokidar v4's
    // fsevents backend drops in-place file writes (truncate+write on the same inode,
    // as `fs.writeFile` and many editors do) while still catching atomic renames —
    // so hot reload silently misses real saves. `awaitWriteFinish` coalesces the
    // burst of events a single save emits into one stable trigger.
    const cwd = process.cwd()
    const watcher = chokidar.watch(cwd, {
      ignoreInitial: true,
      // Skip dependencies, our own build output (writing there would loop), and vcs.
      ignored: (p: string) =>
        /(^|[/\\])(node_modules|\.pylon|\.git)([/\\]|$)/.test(p),
      awaitWriteFinish: {stabilityThreshold: 200, pollInterval: 50}
    })
    watcher.on('all', () => void sync())

    consola.box(`Pylon is up and running!

Press \`Ctrl + C\` to stop the server.

Encounter any issues? Report them here:
https://github.com/getcronit/pylon/issues

We value your feedback—help us make Pylon even better!`)

    const cleanupAndExit = async () => {
      await watcher.close().catch(() => {})
      await reload.close().catch(() => {})
      await ctx.dispose().catch(() => {})
      await killServer()
      process.exit(0)
    }
    process.on('SIGINT', cleanupAndExit)
    process.on('SIGTERM', cleanupAndExit)
    process.on('SIGHUP', cleanupAndExit)
    process.on('exit', () => killServer())

    analytics.capture({
      distinctId,
      event: 'dev server started',
      properties: {
        command,
        dependencies,
        pylonConfig: await readPylonConfig(),
        $session_id: sessionId
      }
    })

    // Keep the process alive in watch mode (active handles: watcher + child).
    await new Promise<void>(() => {})
  })

program
  .command('worker')
  .description(
    'Run the Pylon background worker (queue consumers + outbox relay) — unbundled, via the loader. The entry should call startWorkers()/runOutboxRelay() from @getcronit/pylon/queues.'
  )
  .option('-e, --entry <path>', 'Worker entry that starts the queue workers', './src/worker.ts')
  .option(
    '-c, --command <command>',
    'Command to run the worker (default: node + the tsx loader on the entry)'
  )
  .action(async options => {
    const entry = path.resolve(process.cwd(), options.entry)
    try {
      await fs.access(entry)
    } catch {
      consola.error(
        `Worker entry not found: ${options.entry}\n` +
          `Create one that registers your queues and starts them, e.g.:\n\n` +
          `  import {startWorkers, runOutboxRelay} from '@getcronit/pylon/queues'\n` +
          `  import './index' // side-effect import: registers queues + processors\n\n` +
          `  await startWorkers()\n` +
          `  await runOutboxRelay()\n`
      )
      process.exit(1)
    }

    // No bundling — run the worker entry through the loader (unbundled), like the server,
    // so it shares Node's one-instance-per-file module graph. For a production deploy,
    // point `-c` at the transpiled output (`pylon build` emits `.pylon/src/worker.js`):
    // e.g. `pylon worker -c "node .pylon/src/worker.js"`.
    const command: string = options.command ?? defaultWorkerCommand(options.entry)

    let worker: ChildProcess | null = startWorkerProcess(command)

    const shutdown = (signal: NodeJS.Signals) => {
      if (worker?.pid) {
        try {
          treeKillSync(worker.pid)
        } catch (e: any) {
          consola.error('Failed to stop worker process', e)
        }
      }
      worker = null
      process.exit(signal === 'SIGINT' ? 0 : 0)
    }
    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('exit', () => worker?.pid && treeKillSync(worker.pid))

    consola.success('Pylon worker started — consuming queues + relaying the outbox.')

    await new Promise<void>(resolve => {
      worker?.on('exit', code => {
        if (code && code !== 0) consola.error(`Worker exited with code ${code}`)
        resolve()
      })
    })
  })

const startWorkerProcess = (command: string) => {
  const [script, ...args] = command.split(' ')
  const child = spawn(script, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? 'production',
      FORCE_COLOR: '1'
    }
  })
  child.on('error', err => consola.error(err))
  return child
}

// Poll the app port until it answers (any HTTP response — even 404 — means it's
// listening). Used to delay the live-reload push until the restarted server can
// actually serve the reload, so the browser never reloads into a dead port.
async function waitForAppReady(port: number, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, {signal: AbortSignal.timeout(1000)})
      return
    } catch {
      await new Promise(r => setTimeout(r, 120))
    }
  }
}

const startDevServer = (
  command: string,
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
): ChildProcess => {
  const [script, ...args] = command.split(' ')

  const child = spawn(script, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      FORCE_COLOR: '1'
    }
  })

  child.on('error', err => {
    consola.error(err)
  })

  if (onExit) child.on('exit', onExit)

  return child
}

try {
  await program.parseAsync(process.argv)
} catch (error) {
  consola.error(error)

  // A CLI command that threw (e.g. a failed build, a config that won't load) must
  // exit non-zero so CI/scripts actually catch it. `exitCode` (not `exit()`) lets
  // the `finally` flush analytics first.
  process.exitCode = 1

  analytics.captureException(error, distinctId, {
    $session_id: sessionId,
    dependencies
  })
} finally {
  await analytics.shutdown()
}
