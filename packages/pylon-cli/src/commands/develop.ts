import {build} from '@getcronit/pylon-builder'
import {$, Subprocess, spawnSync} from 'bun'

import {fetchSchema, generateClient} from '@gqty/cli'
import path from 'path'
import {sfiBuildPath, sfiSourcePath} from '../constants.js'

export default async (options: {port: string}) => {
  const {stdout} = spawnSync([
    'npx',
    '--yes',
    '-p',
    'which',
    'which',
    'pylon-server'
  ])

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
                react: true
              })
            }

            generate()
          }
        }
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
