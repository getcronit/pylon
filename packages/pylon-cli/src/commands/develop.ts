import {build} from '@cronitio/pylon-builder'
import {makeApp, runtime} from '@cronitio/pylon-server'
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

export default async (options: {port: string; client?: boolean}) => {
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

    runtime.server = server
  }

  await build({
    sfiFilePath: sfiSourcePath,
    outputFilePath: sfiBuildPath,
    withClient: options.client,
    watch: true,
    onWatch: async () => {
      await serve()
    }
  })

  await serve()
}
