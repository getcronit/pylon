#!/usr/bin/env node

import * as telemetry from '@getcronit/pylon-telemetry'
import {program, type Command} from 'commander'
import consola from 'consola'
import dotenv from 'dotenv'
import pm2 from 'pm2'

import {version} from '../package.json'
import {build} from './builder'
import {buildClient} from './builder/build-client'

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
        await telemetry.sendBuildEvent({
          duration,
          totalFiles,
          totalSize,
          isDevelopment: false
        })

        await buildClient({schemaChanged})
      }
    })

    await ctx.rebuild()
    await ctx.dispose()
  })

program
  .name('dev')
  .option(
    '-c, --command <command>',
    'Command to run the server',
    'bun run .pylon/index.js'
  )
  .action(main)

type ArgOptions = {
  command: string
  client: boolean
  clientPath: string
  clientPort: string
}

async function main(options: ArgOptions, command: Command) {
  pm2.connect(async function (err) {
    if (err) {
      consola.error(err)
      process.exit(1)
    }

    const ctx = await build({
      sfiFilePath: './src/index.ts',
      outputFilePath: `./.pylon`,
      onBuild: async ({schemaChanged, totalFiles, totalSize, duration}) => {
        await buildClient({schemaChanged})
      }
    })

    await ctx.watch()

    pm2.launchBus((err, bus) => {
      if (err) {
        consola.error(err)
        return
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
        name: 'pylon-dev',
        script: options.command,
        // args: args,
        exec_mode: 'fork',
        instances: 1,
        autorestart: true,
        watch: ['./.pylon'],
        restart_delay: 1000,
        watch_delay: 1000 as any,
        ignore_watch: ['node_modules'],
        env: {
          ...process.env,
          NODE_ENV: 'development'
        }
      } as any,
      function (err, apps) {
        // Check if it is a duplicate start
        if (err) throw err

        consola.box(`
Pylon is up and running!
          
Press \`Ctrl + C\` to stop the server.
          
Encounter any issues? Report them here:
https://github.com/getcronit/pylon/issues
          
We value your feedback—help us make Pylon even better!`)
      }
    )

    process.on('SIGINT', async code => {
      await ctx.cancel()
      pm2.delete('pylon-dev', function (err) {
        pm2.disconnect()
        process.exit(0)
      })
    })
  })
}

program.parse()
