#!/usr/bin/env node
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
import {runDbCommand} from './db'
import {generatePylonTypes} from './pull'
import {treeKillSync} from './tree-kill'
import {findConfigFile} from './builder/bundler/build-config'

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

/**
 * The dev worker command: run the internal bootstrap (queues/run-worker) unbundled through the
 * loader. The bootstrap imports the app + config from env-passed paths and boots them in worker
 * role — nothing for the user to author. Used by `pylon dev --worker`; production runs the
 * generated `.pylon/worker.mjs` directly instead.
 */
function defaultWorkerCommand(): string {
  // dist/cli/index.js → dist/queues/run-worker.js. `.js` (already transpiled) but the loader
  // stays active so the bootstrap can import the user's `src/index.ts`.
  const bootstrap = path.join(path.dirname(fileURLToPath(import.meta.url)), '../queues/run-worker.js')
  return tsxRun(bootstrap)
}

/** The app entry that, when imported, constructs your `Pylon` and registers its models. */
const ENTRY_DEFAULT = './src/index.ts'
/** Resolve the entry: `--entry`, else the deprecated `--models` alias, else the default. */
const entryOf = (o: {entry?: string; models?: string}): string =>
  o.entry ?? o.models ?? ENTRY_DEFAULT

program.name('pylon-dev').description('Pylon Development CLI').version(version)

// `-v/--verbose` raises the logger to debug level, so `consola.debug(...)` diagnostics anywhere
// in a command become visible — no per-call gating. Declared on the root (`pylon --verbose
// <cmd>`); commands that add detail also declare it locally (`pylon <cmd> --verbose`). The
// preAction hook sets the level before any action runs, reading whichever position was used.
program.option('-v, --verbose', 'Verbose output — debug-level logging')
program.hook('preAction', (_thisCommand, actionCommand) => {
  if (actionCommand.optsWithGlobals().verbose) consola.level = 4 // 4 = debug (default 3 = info)
})

program
  .command('build')
  .description('Build the Pylon Schema')
  .option(
    '--standalone',
    'After building, trace the runtime file graph into .pylon/standalone/ — a self-contained deploy artifact (app + only the node_modules it uses) that runs with `node` and no install.'
  )
  .option(
    '--include <path>',
    'With --standalone: also copy this project-relative file/dir into the artifact (repeatable). Use it for data the app reads at runtime — e.g. `--include content` — which the tracer cannot see.',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[]
  )
  .option('-v, --verbose', 'Verbose output — debug-level logging (e.g. unresolved dynamic imports)')
  .action(async (options: {standalone?: boolean; include?: string[]}) => {
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

      if (options.standalone) {
        const {buildStandalone} = await import('./builder/standalone.js')
        const cwd = process.cwd()
        const res = await buildStandalone({
          cwd,
          outDir: path.join(cwd, '.pylon'),
          include: options.include ?? []
        })
        const mb = (res.byteCount / 1024 / 1024).toFixed(1)
        consola.success(
          `Standalone artifact: ${res.fileCount} files (${mb} MB) → ${path.relative(cwd, res.outDir)}\n` +
            `  Run: node ${path.relative(cwd, res.launcher)}`
        )
        // Platform-lock guard: native binaries were traced for the BUILD host only, so the
        // artifact runs solely on a matching OS·arch·libc. Warn loudly for the classic footgun
        // (building on macOS/Windows for a Linux deploy — the binaries won't load there).
        if (res.nativeBinaries > 0) {
          const locked = res.nativePlatforms.length
            ? res.nativePlatforms.join(', ')
            : `${process.platform}-${process.arch}`
          const lead =
            `Bundled ${res.nativeBinaries} native binar${res.nativeBinaries === 1 ? 'y' : 'ies'} for ` +
            `${locked} — this artifact runs ONLY on a matching platform (OS · arch · libc).`
          if (process.platform === 'darwin' || process.platform === 'win32') {
            consola.warn(
              `${lead}\n  You built on ${process.platform}; production is almost always Linux, where ` +
                `these WON'T load. Build inside a Linux container matching your deploy target (see the ` +
                `standalone Dockerfile).`
            )
          } else {
            consola.info(`${lead} Build on your deploy target's platform to keep them aligned.`)
          }
        }
        if (res.warnings.length) {
          const suffix = res.ignoredWarnings
            ? ` (${res.ignoredWarnings} benign trace note${res.ignoredWarnings === 1 ? '' : 's'} — non-code files / optional deps — hidden)`
            : ''
          consola.warn(
            `nft couldn't follow ${res.warnings.length} dynamic import(s) that MAY need a runtime ` +
              `file${suffix}. If the app is missing a data file at runtime, pass it via --include. ` +
              `Re-run with --verbose to list them.`
          )
          // Rendered only when --verbose raised the level to debug.
          consola.debug(
            `Unresolved dynamic imports (add a real one to --include, or as an explicit trace root):\n` +
              res.warnings.map(m => `  • ${m}`).join('\n')
          )
        } else if (res.ignoredWarnings) {
          // Only benign notes — don't alarm anyone at the default level; a quiet line for --verbose.
          consola.debug(
            `nft emitted ${res.ignoredWarnings} benign trace note(s) (non-code files / optional deps), all safe to ignore.`
          )
        }
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
        for (const a of appsStatus) {
          consola.info(
            `app ${a.app}: ${a.pendingChanges} uncaptured change(s), ${a.unapplied.length} unapplied`
          )
          for (const d of (a.pending ?? []).slice(0, 25)) consola.log(`    - ${d}`)
          if ((a.pending?.length ?? 0) > 25)
            consola.log(`    … and ${a.pending!.length - 25} more`)
        }
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
  .option(
    '--using <spec...>',
    "Conversion expression for a type change Postgres can't cast on its own, " +
      'e.g. --using user.age=\'age::integer\''
  )
  .option(
    '--using-down <spec...>',
    'Conversion expression for the REVERSE of a --using type change (omit and the ' +
      'migration is irreversible), e.g. --using-down user.age=\'age::text\''
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
      // `--using table.column=<expr>` / `--using-down table.column=<expr>`, merged
      // per column so one hint carries both directions. The expression may itself
      // contain `=` (`col::integer = 1`), so only the FIRST `=` separates it.
      const castHints: Array<{table: string; column: string; using?: string; usingDown?: string}> = []
      const addCast = (spec: string, key: 'using' | 'usingDown') => {
        const eq = spec.indexOf('=')
        const [table, column] = spec.slice(0, eq < 0 ? 0 : eq).split('.')
        const expr = eq < 0 ? '' : spec.slice(eq + 1)
        if (!table || !column || !expr) {
          throw new Error(
            `Invalid --${key === 'using' ? 'using' : 'using-down'} "${spec}" ` +
              `(expected table.column=<expression>)`
          )
        }
        const existing = castHints.find(h => h.table === table && h.column === column)
        if (existing) existing[key] = expr
        else castHints.push({table, column, [key]: expr})
      }
      for (const spec of (options.using as string[]) ?? []) addCast(spec, 'using')
      for (const spec of (options.usingDown as string[]) ?? []) addCast(spec, 'usingDown')

      const {created, destructive, renameCandidates, tableRenameCandidates} = await runDbCommand({
        command: 'diff',
        name,
        app: options.app,
        models: entryOf(options),
        dir: options.dir,
        renames,
        tableRenames,
        castHints
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
      // Name them. A bare count can't be told apart from a mis-scoped diff, which
      // is exactly how an apps-mode bug once read as "345 uncaptured changes".
      const detail = check!.uncapturedDetail ?? []
      const shown = detail.slice(0, 25)
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
        for (const d of shown) consola.log(`    - ${d}`)
        if (detail.length > shown.length)
          consola.log(`    … and ${detail.length - shown.length} more`)
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
    '--worker',
    'Run a background WORKER instead of the web server — consume queues + drain the outbox, no HTTP, with watch/restart. Production equivalent: `node .pylon/worker.mjs`.'
  )
  .option(
    '--inspect [port]',
    'Open the Node inspector on the dev process so breakpoints in your resolvers bind (default port 9229). Attach via chrome://inspect.'
  )
  .option('--inspect-brk [port]', 'Like --inspect, but wait for a debugger to attach before booting.')
  .action(async options => {
    // Worker mode: run the queue worker from source (no web server), then stop here.
    if (options.worker) {
      let worker: {close(): Promise<void>} | undefined
      try {
        worker = await startWorkerDev()
      } catch (e) {
        consola.error(
          '[Pylon] Dev worker failed to start:',
          e instanceof Error ? (e.stack ?? e.message) : e
        )
        process.exit(1)
      }
      consola.success(
        'Pylon dev worker — consuming queues + draining the outbox. Watching src for changes.'
      )
      const shutdownWorker = async () => {
        await worker?.close().catch(() => {})
        process.exit(0)
      }
      process.on('SIGINT', shutdownWorker)
      process.on('SIGTERM', shutdownWorker)
      process.on('SIGHUP', shutdownWorker)
      return
    }

    // Debugging: open the inspector on THIS process (where the resolvers run) via node:inspector
    // rather than relying on an inherited `--inspect` — so `pnpm pylon dev --inspect` works
    // cleanly (the package-manager wrapper never steals the port) and DevTools attaches to the
    // app process. No `--inspect` flag exists to leak into the bundler workers we spawn.
    if (options.inspect || options.inspectBrk) {
      const raw = options.inspectBrk ?? options.inspect
      const inspectPort = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : 9229
      const inspector = await import('node:inspector')
      inspector.open(inspectPort, '127.0.0.1', Boolean(options.inspectBrk))
      // The dev server picks this up (via inspector.url()) and exposes inspector.console, which is
      // both how the logger detects DevTools and how it streams expandable record objects there.
      consola.info(
        `Inspector open on 127.0.0.1:${inspectPort} — attach via chrome://inspect. ` +
          `Breakpoints in your resolvers and routes bind on this process.`
      )
    }

    // Direct-execution dev server: ONE process runs src/index.ts through Vite's backend
    // runner, compiles the schema in-process, boots the app in-memory, and hot-swaps on
    // edit — no glue files, no worker, no IPC. See cli/dev/dev-server.ts.
    const {startDevServer} = await import('./dev/dev-server.js')
    const port = Number(process.env.PORT) || 3000

    let dev: {close(): Promise<void>} | undefined
    try {
      dev = await startDevServer({port})
    } catch (e) {
      consola.error(
        '[Pylon] Dev server failed to start:',
        e instanceof Error ? (e.stack ?? e.message) : e
      )
      process.exit(1)
    }

    consola.box(`Pylon is up and running!

Press \`Ctrl + C\` to stop the server.

Encounter any issues? Report them here:
https://github.com/getcronit/pylon/issues

We value your feedback—help us make Pylon even better!`)

    const shutdown = async () => {
      await dev?.close().catch(() => {})
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('SIGHUP', shutdown)

    analytics.capture({
      distinctId,
      event: 'dev server started',
      properties: {
        dependencies,
        pylonConfig: await readPylonConfig(),
        $session_id: sessionId
      }
    })

    // Keep the process alive in watch mode.
    await new Promise<void>(() => {})
  })

/**
 * `pylon dev --worker`: run the app as a background WORKER from source — consume queues +
 * drain the outbox, no HTTP server — restarting on a `src`/`pylon.config` change. This is the
 * dev twin of production's `node .pylon/worker.mjs`: it boots `src/index.ts` + `pylon.config`
 * in worker role (PYLON_ROLE=worker) unbundled via the loader, so `executeConfig` gates out
 * the web-only plugins (usePages, useNodeServer) — the worker never serves or imports them.
 */
async function startWorkerDev(): Promise<{close(): Promise<void>}> {
  const cwd = process.cwd()
  const appEntry = path.resolve(cwd, './src/index.ts')
  try {
    await fs.access(appEntry)
  } catch {
    consola.error(
      'App entry not found: ./src/index.ts — `pylon dev --worker` boots your app to run its queues.'
    )
    process.exit(1)
  }
  const configFile = findConfigFile(cwd)
  // The run-worker bootstrap reads these; PYLON_ROLE=worker makes executeConfig skip the
  // web-only plugins and useQueues start consuming. NODE_ENV=development for dev parity.
  const env: Record<string, string> = {
    PYLON_ROLE: 'worker',
    NODE_ENV: 'development',
    __PYLON_WORKER_APP__: appEntry
  }
  if (configFile) env.__PYLON_WORKER_CONFIG__ = configFile

  let child: ChildProcess | null = startWorkerProcess(defaultWorkerCommand(), env)
  const killChild = () => {
    if (child?.pid) {
      try {
        treeKillSync(child.pid)
      } catch (e: any) {
        consola.error('Failed to stop worker process', e)
      }
    }
  }

  // Watch src + the config; debounce a burst of writes into one restart.
  const watchPaths = [path.join(cwd, 'src')]
  if (configFile) watchPaths.push(configFile)
  let debounce: ReturnType<typeof setTimeout> | undefined
  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: {stabilityThreshold: 150, pollInterval: 30}
  })
  watcher.on('all', () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      consola.info('Change detected — restarting worker…')
      killChild()
      child = startWorkerProcess(defaultWorkerCommand(), env)
    }, 150)
  })

  return {
    close: async () => {
      if (debounce) clearTimeout(debounce)
      await watcher.close().catch(() => {})
      killChild()
      child = null
    }
  }
}

const startWorkerProcess = (command: string, extraEnv: Record<string, string> = {}) => {
  const [script, ...args] = command.split(' ')
  const child = spawn(script, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? 'production',
      FORCE_COLOR: '1',
      ...extraEnv
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
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void,
  opts?: {ipc?: boolean}
): ChildProcess => {
  const [script, ...args] = command.split(' ')

  const child = spawn(script, args, {
    // `ipc` adds a 4th stdio channel so the dev CLI can `worker.send({reload})` and
    // the worker can ack — the basis of page hot-swap without a restart.
    stdio: opts?.ipc ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
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
