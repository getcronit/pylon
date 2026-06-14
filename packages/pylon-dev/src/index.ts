import {program} from 'commander'

import {spawn, type ChildProcess} from 'child_process'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import consola from 'consola'
import dotenv from 'dotenv'
import esbuild from 'esbuild'
import {version} from '../package.json'
import {
  analytics,
  dependencies,
  distinctId,
  readPylonConfig,
  sessionId
} from './analytics'
import {build} from './builder'
import {buildClient} from './builder/build-client'
import {runDbCommand} from './db'
import {generatePylonTypes} from './pull'
import {treeKillSync} from './tree-kill'

dotenv.config()

program.name('pylon-dev').description('Pylon Development CLI').version(version)

program
  .command('build')
  .description('Build the Pylon Schema')
  .action(async () => {
    const ctx = await build({
      sfiFilePath: './src/index.ts',
      outputFilePath: './.pylon',
      onBuild: async ({totalFiles, totalSize, duration, schemaChanged}) => {
        try {
          analytics.capture({
            distinctId,
            event: 'build completed',
            properties: {
              duration,
              totalFiles,
              totalSize,
              schemaChanged,
              dependencies,
              isDevelopment: false,
              $session_id: sessionId
            }
          })

          await buildClient({schemaChanged})
        } catch (e) {
          consola.error('Error during build callback', e)
        }
      }
    })

    const cleanupAndExit = async () => {
      await ctx.dispose()
      process.exit(0)
    }

    process.on('SIGINT', cleanupAndExit)
    process.on('SIGTERM', cleanupAndExit)
    process.on('SIGHUP', cleanupAndExit)

    await ctx.rebuild()
    await ctx.dispose()
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async options => {
    try {
      const {status, appsStatus, drift} = await runDbCommand({
        command: 'status',
        models: options.models,
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('-a, --app <name>', 'Generate for a specific app (apps mode)')
  .option(
    '--rename <spec...>',
    'Treat a drop+add as a rename, e.g. --rename table.old=table.new'
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
      const {created, destructive, renameCandidates} = await runDbCommand({
        command: 'diff',
        name,
        app: options.app,
        models: options.models,
        dir: options.dir,
        renames
      })
      if (created) {
        consola.success(`Created migration ${created}`)
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('--down', 'Show the down (reverse) SQL')
  .action(async options => {
    try {
      const {plan} = await runDbCommand({
        command: 'plan',
        models: options.models,
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async options => {
    try {
      const {check} = await runDbCommand({
        command: 'check',
        models: options.models,
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async options => {
    try {
      const {applied, apps} = await runDbCommand({
        command: 'migrate',
        models: options.models,
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('-s, --steps <n>', 'How many migrations to reverse', '1')
  .action(async options => {
    try {
      const {rolledBack} = await runDbCommand({
        command: 'rollback',
        models: options.models,
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('--rolled-back', 'Mark as rolled-back (default: applied)')
  .action(async (name, options) => {
    try {
      const {resolved} = await runDbCommand({
        command: 'resolve',
        name,
        models: options.models,
        dir: options.dir,
        resolve: options.rolledBack ? 'rolled-back' : 'applied'
      })
      consola.success(`Marked ${resolved!.name} as ${resolved!.as}`)
    } catch (error) {
      consola.error(error)
      process.exit(1)
    }
  })

db.command('seed')
  .description('Run the seed file to populate the database (requires DATABASE_URL)')
  .option('-s, --seed <path>', 'Seed file (default exports a function)', './src/seed.ts')
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory (unused)', './migrations')
  .action(async options => {
    try {
      await runDbCommand({command: 'seed', seed: options.seed, models: options.models})
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
  .option('-m, --models <path>', 'Entry that imports @getcronit/pylon-db', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .option('-o, --out <path>', 'Where to write generated model stubs', './src/models.generated.ts')
  .action(async (name, options) => {
    try {
      const {baseline} = await runDbCommand({
        command: 'baseline',
        name,
        models: options.models,
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async (name, options) => {
    try {
      const {merged} = await runDbCommand({
        command: 'merge',
        name,
        models: options.models,
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async (name, options) => {
    try {
      const {squashed} = await runDbCommand({
        command: 'squash',
        name,
        models: options.models,
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory', './migrations')
  .action(async options => {
    try {
      const {applied, apps} = await runDbCommand({
        command: 'deploy',
        models: options.models,
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
  .option('-m, --models <path>', 'Entry that imports the models', './src/index.ts')
  .option('-d, --dir <path>', 'Migrations directory (unused)', './migrations')
  .action(async options => {
    try {
      await runDbCommand({command: 'push', models: options.models})
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
    'Command to run the server',
    'bun run .pylon/index.js'
  )
  .action(async options => {
    let serverProcess: ChildProcess | null = null
    // `killing` distinguishes our intentional kill from a real crash (read by the
    // child's `exit` handler). `restartChain` serializes rebuild→restart so
    // overlapping `onBuild`s (multiple esbuild contexts / rapid saves) can't
    // double-spawn or race on the port.
    let killing = false
    let restartChain: Promise<void> = Promise.resolve()

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
          treeKillSync(proc.pid)
        } catch (e: any) {
          consola.error('Failed to kill server process', e)
          finish()
        }
        setTimeout(finish, 4000).unref?.()
      })

    let ctx: {
      watch: () => Promise<void>
      rebuild: () => Promise<void>
      dispose: () => Promise<void>
      cancel: () => Promise<void>
    } | null = null

    await new Promise<void>(async (resolve, reject) => {
      try {
        ctx = await build({
          sfiFilePath: './src/index.ts',
          outputFilePath: `./.pylon`,
          onBuild: async ({schemaChanged, totalFiles, totalSize, duration}) => {
            // Single-flight: chain restarts so concurrent onBuilds can't interleave
            // (kill → await exit → spawn runs to completion before the next starts).
            restartChain = restartChain
              .then(async () => {
                await buildClient({schemaChanged})

                await killServer()

                serverProcess = startDevServer(options.command, (code, signal) => {
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

                analytics.capture({
                  distinctId,
                  event: 'build completed',
                  properties: {
                    duration,
                    totalFiles,
                    totalSize,
                    schemaChanged,
                    dependencies,
                    pylonConfig: await readPylonConfig(),
                    isDevelopment: true,
                    $session_id: sessionId
                  }
                })
              })
              .catch(e => {
                consola.error('Error during dev build callback', e)
              })
            return restartChain
          },
          skipInitialBuild: true
        })

        await ctx.watch()

        consola.box(`Pylon is up and running!
        
Press \`Ctrl + C\` to stop the server.
                
Encounter any issues? Report them here:
https://github.com/getcronit/pylon/issues
                
We value your feedback—help us make Pylon even better!`)

        const cleanupAndExit = async () => {
          if (ctx) {
            await ctx.dispose()
          }
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
            command: options.command,
            dependencies,
            pylonConfig: await readPylonConfig(),
            $session_id: sessionId
          }
        })
      } catch (error) {
        if (ctx) {
          await ctx.dispose()
        }
        await killServer()
        reject(error)
      }
    })
  })

program
  .command('worker')
  .description(
    'Run the Pylon background worker: bundle the worker entry and run it (queue consumers + outbox relay). The entry should call startWorkers()/runOutboxRelay() from @getcronit/pylon-queues.'
  )
  .option('-e, --entry <path>', 'Worker entry that starts the queue workers', './src/worker.ts')
  .option('-o, --output <path>', 'Bundled worker output', './.pylon/worker.js')
  .option('-c, --command <command>', 'Command to run the built worker', 'bun run .pylon/worker.js')
  .action(async options => {
    const entry = path.resolve(process.cwd(), options.entry)
    try {
      await fs.access(entry)
    } catch {
      consola.error(
        `Worker entry not found: ${options.entry}\n` +
          `Create one that registers your queues and starts them, e.g.:\n\n` +
          `  import {startWorkers, runOutboxRelay} from '@getcronit/pylon-queues'\n` +
          `  import './index' // side-effect import: registers queues + processors\n\n` +
          `  await startWorkers()\n` +
          `  await runOutboxRelay()\n`
      )
      process.exit(1)
    }

    const output = path.resolve(process.cwd(), options.output)
    await esbuild.build({
      entryPoints: [entry],
      outfile: output,
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'esm',
      sourcemap: 'linked',
      packages: 'external',
      logLevel: 'silent',
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
          useDefineForClassFields: false
        }
      }
    })

    let worker: ChildProcess | null = startWorkerProcess(options.command)

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
