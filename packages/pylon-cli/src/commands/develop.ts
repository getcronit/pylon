import {build} from '@getcronit/pylon-builder'
import {$, Subprocess} from 'bun'

import {sfiBuildPath, sfiSourcePath} from '../constants.js'
import path from 'path'
import {fetchSchema, generateClient} from '@gqty/cli'

export default async (options: {port: string}) => {
  const {stdout} = await $`npx -p which which pylon-server`

  const binPath = stdout.toString().trim()

  let currentProc: Subprocess | null = null

  let serve = async () => {
    if (currentProc) {
      currentProc.kill()

      await currentProc.exited
    }

    currentProc = Bun.spawn({
      cmd: ['bun', 'run', binPath, '--port', options.port],
      stdout: 'inherit'
    })
  }

  const packageJson = await import(path.resolve(process.cwd(), 'package.json'))

  const clientPath = packageJson.pylon?.gqty

  if (clientPath) {
    const endpoint = `http://localhost:${options.port}/graphql`

    console.log('Generating client...', {endpoint, clientPath})

    const schema = await fetchSchema(endpoint)

    await generateClient(schema, {
      endpoint,
      destination: clientPath,
      react: true
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
