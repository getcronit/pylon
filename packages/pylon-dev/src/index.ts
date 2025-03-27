import {program, type Command} from 'commander'

import consola from 'consola'
import dotenv from 'dotenv'
import pm2 from 'pm2'
import {version} from '../package.json'
import {
  analytics,
  distinctId,
  sessionId,
  dependencies,
  readPylonConfig
} from './analytics'
import {build} from './builder'
import {buildClient} from './builder/build-client'

const processName = `pylon-dev-${sessionId}`

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
      }
    })

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
    await new Promise<void>(async (resolve, reject) => {
      try {
        await connectPM2()

        const ctx = await build({
          sfiFilePath: './src/index.ts',
          outputFilePath: `./.pylon`,
          onBuild: async ({schemaChanged, totalFiles, totalSize, duration}) => {
            await buildClient({schemaChanged})

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
          }
        })

        await ctx.watch()

        await startDevServer(options.command)

        consola.box(`Pylon is up and running!
        
Press \`Ctrl + C\` to stop the server.
                
Encounter any issues? Report them here:
https://github.com/getcronit/pylon/issues
                
We value your feedback—help us make Pylon even better!`)

        process.on('SIGINT', async () => {
          await ctx.cancel()
          await stopDevServerAndDisconnect()

          resolve()
        })

        process.on('SIGTERM', async () => {
          await ctx.cancel()
          await stopDevServerAndDisconnect()

          resolve()
        })

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
        await stopDevServerAndDisconnect()
        reject(error)
      }
    })
  })

const connectPM2 = () => {
  return new Promise<void>((resolve, reject) => {
    pm2.connect(err => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

const startDevServer = (command: string) => {
  return new Promise<void>((resolve, reject) => {
    pm2.launchBus((err, bus) => {
      if (err) {
        reject(err)
      }

      bus.on('log:out', data => {
        consola.log(data.data.trim())
      })

      bus.on('log:err', data => {
        consola.error(data.data)
      })
    })

    pm2.start(
      {
        name: processName,
        script: command,
        exec_mode: 'fork',
        instances: 1,
        autorestart: true,
        watch: ['./.pylon'],
        restart_delay: 5000,
        watch_delay: 1000 as any,
        ignore_watch: ['node_modules'],
        env: {
          ...process.env,
          NODE_ENV: 'development'
        }
      } as any,
      function (err, apps) {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      }
    )
  })
}

const stopDevServerAndDisconnect = async () => {
  try {
    await new Promise<void>((resolve, reject) => {
      pm2.delete(processName, function (err) {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  } catch {
  } finally {
    pm2.disconnect()
  }
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
