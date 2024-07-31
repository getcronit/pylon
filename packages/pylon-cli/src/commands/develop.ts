import {build} from '@getcronit/pylon-builder'
import {$, Subprocess, spawnSync} from 'bun'

import {fetchSchema, generateClient} from '@gqty/cli'
import path from 'path'
import {sfiBuildPath, sfiSourcePath} from '../constants.js'
import {logger} from '@getcronit/pylon'

export default async (options: {port: string}) => {
  const {stdout} = spawnSync(['bunx', '--yes', '-p', 'which', 'pylon-server'])

  const binPath = stdout.toString().trim()

  const packageJson = await import(path.resolve(process.cwd(), 'package.json'))

  let currentProc: Subprocess | null = null

  let serve = async () => {
    if (currentProc) {
      currentProc.kill()

      await currentProc.exited
    }

    currentProc = Bun.spawn({
      cmd: ['bun', 'run', binPath, '--port', options.port],
      stdout: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development'
      },
      async ipc(message, subprocess) {
        if (message === 'ready') {
          const clientPath = packageJson.pylon?.gqty

          if (clientPath) {
            const endpoint = `http://localhost:${options.port}/graphql`

            const generate = async () => {
              const schema = await fetchSchema(endpoint)

              await generateClient(schema, {
                endpoint,
                destination: clientPath,
                react: true,
                scalarTypes: {
                  Number: 'number',
                  Object: 'Record<string, unknown>'
                }
              })
            }

            generate()
          }
        }
      },
      onExit(proc) {
        // Kill if exited with code 1

        logger.error(
          `Pylon exited with code ${proc.exitCode}, fix the error and save the file to restart the server`
        )
      }
    })
  }

  await build({
    sfiFilePath: sfiSourcePath,
    outputFilePath: sfiBuildPath,
    watch: true,
    onWatch: async () => {
      await serve()
    }
  })

  await serve()
}
