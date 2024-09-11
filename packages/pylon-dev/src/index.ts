#!/usr/bin/env node

import {build} from '@getcronit/pylon-builder'
import {fetchSchema, generateClient} from '@gqty/cli'
import {program, type Command} from 'commander'
import consola from 'consola'
import path from 'path'
import {version} from '../package.json'
import {ChildProcess, spawn} from 'child_process'
import kill from 'treekill'

program.name('pylon-dev').description('Pylon Development CLI').version(version)

program
  .command('build')
  .description('Build the Pylon Schema')
  .action(async () => {
    consola.start('[Pylon]: Building schema')

    await build({
      sfiFilePath: './src/index.ts',
      outputFilePath: './.pylon'
    })

    consola.success('[Pylon]: Schema built')
  })

program
  .name('dev')
  .option(
    '-c, --command <command>',
    'Command to run the server',
    'bun run .pylon/index.js'
  )
  .option('--client', "Generate the client from the server's schema")
  .option('--test', 'Test')
  .option(
    '--client-path <clientPath>',
    'Path to generate the client to',
    'gqty/index.ts'
  )
  .option(
    '--client-port <clientPort>',
    'Port of the pylon server to generate the client from',
    '3000'
  )
  .action(main)

type ArgOptions = {
  command: string
  client: boolean
  clientPath: string
  clientPort: string
}

async function main(options: ArgOptions, command: Command) {
  consola.log(`[Pylon]: ${command.name()} version ${command.version()}`)

  let currentProc: ChildProcess | null = null

  let serve = async (shouldGenerateClient: boolean = false) => {
    if (currentProc) {
      // Remove all listeners to prevent the pylon dev server from crashing
      currentProc.removeAllListeners()

      kill(currentProc.pid, 'SIGINT', err => {
        if (err) {
          consola.error(err)
        }
      })
    }

    await new Promise(resolve => setTimeout(resolve, 1000))

    currentProc = spawn(options.command, {
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    currentProc.on('exit', code => {
      // if (code === 143 || code === null) {
      //   return
      // }

      if (code === 0) {
        consola.success('Pylon server stopped')
        process.exit(0)
      }

      consola.error(
        `Pylon exited with code ${code}, fix the error and save the file to restart the server`
      )
    })

    if (
      shouldGenerateClient &&
      options.client &&
      options.clientPath &&
      options.clientPort
    ) {
      const clientPath = path.resolve(process.cwd(), options.clientPath)

      const endpoint = `http://localhost:${options.clientPort}/graphql`

      console.log('Generating client...', endpoint)

      const generate = async () => {
        consola.start('[Pylon]: Fetching schema from server')

        const schema = await fetchSchema(endpoint, {
          silent: true
        })

        consola.success('[Pylon]: Schema fetched')

        consola.start('[Pylon]: Generating client')

        await generateClient(schema, {
          endpoint,
          destination: clientPath,
          react: true,
          scalarTypes: {
            Number: 'number',
            Object: 'Record<string, unknown>'
          }
        })

        consola.success('[Pylon]: Client generated')
      }

      let retries = 0

      const generateWithRetry = async () => {
        try {
          await generate()
        } catch (e) {
          retries++

          if (retries < 5) {
            setTimeout(() => {
              generateWithRetry()
            }, 1000)
          }
        }
      }

      generateWithRetry()
    }
  }

  consola.start('[Pylon]: Building schema')

  try {
    await build({
      sfiFilePath: './src/index.ts',
      outputFilePath: `./.pylon`,
      watch: true,
      onWatch: async (schemaChanged: boolean) => {
        const isServerRunning = currentProc !== null

        if (isServerRunning) {
          consola.start('[Pylon]: Reloading server')
        } else {
          consola.start('[Pylon]: Starting server')
        }

        await serve(schemaChanged)

        if (isServerRunning) {
          consola.ready('[Pylon]: Server reloaded')
        } else {
          consola.ready('[Pylon]: Server started')

          consola.box(`
    Pylon is up and running!

    Press \`Ctrl + C\` to stop the server.

    Encounter any issues? Report them here:  
    https://github.com/getcronit/pylon/issues

    We value your feedback—help us make Pylon even better!
          `)
        }

        if (schemaChanged) {
          consola.info('[Pylon]: Schema updated')
        }
      }
    })

    consola.success('[Pylon]: Schema built')

    consola.start('[Pylon]: Starting server')
    await serve(true)
    consola.ready('[Pylon]: Server started')

    consola.box(`
    Pylon is up and running!

    Press \`Ctrl + C\` to stop the server.
  
    Encounter any issues? Report them here:  
    https://github.com/getcronit/pylon/issues
  
    We value your feedback—help us make Pylon even better!
  `)
  } catch (e) {
    consola.error("[Pylon]: Couldn't build schema", e)

    // Kill the server if it's running
    const proc = currentProc as ChildProcess | null
    if (proc) {
      proc.removeAllListeners()

      kill(proc.pid, 'SIGINT', err => {
        if (err) {
          consola.error(err)
        }
      })
    }
  }
}

program.parse()
