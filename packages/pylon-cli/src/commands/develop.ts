import {build} from '@getcronit/pylon-builder'
import {makeApp, runtime} from '@getcronit/pylon-server'
import {fetchSchema, generateClient} from '@gqty/cli'
import path from 'path'
import {Server} from 'bun'

import {sfiBuildPath, sfiSourcePath} from '../constants.js'
import {importFresh} from '../utils/import-fresh.js'

const loadApp = async (outputFile: string) => {
  const sfi = await importFresh(outputFile)

  const app = await makeApp({
    schema: {
      typeDefs: sfi.typeDefs,
      resolvers: sfi.default.graphqlResolvers
    },
    configureApp: sfi.configureApp
  })

  return {
    app,
    configureServer: sfi.configureServer,
    configureWebsocket: sfi.configureWebsocket
  }
}

export default async (options: {port: string}) => {
  const filePath = path.join(process.cwd(), sfiBuildPath, 'index.js')

  let server: Server | null = null

  let serve = async () => {
    const {app, configureServer, configureWebsocket} = await loadApp(filePath)

    if (server) {
      server.stop(true)

      server = null
    }

    if (!server) {
      server = Bun.serve({
        ...app,
        port: options.port,
        websocket: configureWebsocket
          ? configureWebsocket(runtime.server)
          : undefined
      })

      if (server) {
        // With color
        console.log(
          '\x1b[32m%s\x1b[0m',
          `Listening on http://${server.hostname}:${server.port}`
        )
      }
    }

    if (configureServer) {
      await configureServer(server)
    }

    // Load the package.json file
    const packageJson = await importFresh(
      path.resolve(process.cwd(), 'package.json')
    )

    console.log('packageJson', packageJson)

    const clientPath = packageJson.pylon?.gqty

    if (clientPath) {
      const endpoint = `http://localhost:${server.port}/graphql`

      console.log('Generating client...', {endpoint, clientPath})

      const schema = await fetchSchema(endpoint)

      await generateClient(schema, {
        endpoint,
        destination: clientPath,
        react: true
      })
    }

    runtime.server = server
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
