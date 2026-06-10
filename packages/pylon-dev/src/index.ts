import {program} from 'commander'

import {spawn, type ChildProcess} from 'child_process'
import consola from 'consola'
import dotenv from 'dotenv'
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
      const {status} = await runDbCommand({
        command: 'status',
        models: options.models,
        dir: options.dir
      })
      const pending = status!.pendingChanges.length
      consola.info(
        `Uncaptured schema changes: ${pending}\n` +
          `Migrations: ${status!.migrations.length} (${status!.unapplied.length} unapplied)`
      )
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
      const {applied} = await runDbCommand({
        command: 'migrate',
        models: options.models,
        dir: options.dir
      })
      if (applied && applied.length > 0)
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

    const killServer = async () => {
      if (serverProcess && serverProcess.pid) {
        try {
          treeKillSync(serverProcess.pid)
        } catch (e: any) {
          consola.error('Failed to kill server process', e)
        }
        serverProcess = null
      }
    }

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
            try {
              await buildClient({schemaChanged})

              await killServer()

              serverProcess = await startDevServer(options.command)

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
            } catch (e) {
              consola.error('Error during dev build callback', e)
            }
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

const startDevServer = async (command: string) => {
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

  return child
}

try {
  await program.parseAsync(process.argv)
} catch (error) {
  consola.error(error)

  analytics.captureException(error, distinctId, {
    $session_id: sessionId,
    dependencies
  })
} finally {
  await analytics.shutdown()
}
