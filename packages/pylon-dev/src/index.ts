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

              console.log('Server process started with PID', serverProcess.pid)

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
