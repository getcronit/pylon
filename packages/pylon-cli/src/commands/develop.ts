import {build} from '@cronitio/pylon-builder'
import {makeApp} from '@cronitio/pylon-server'
import path from 'path'

import {sfiBuildPath, sfiSourcePath} from '../constants.js'
import {importFresh} from '../utils/import-fresh.js'

const loadApp = async (outputFile: string) => {
  const sfi = await importFresh(outputFile)

  const app = makeApp({
    schema: {
      typeDefs: sfi.typeDefs,
      resolvers: sfi.default.graphqlResolvers
    },
    configureApp: sfi.default.options.configureApp
  })

  return app
}

export default async (options: {port: string; client?: boolean}) => {
  interface Server {
    development: boolean
    hostname: string
    port: number
    pendingRequests: number
    stop(b?: boolean): void
  }

  const filePath = path.join(process.cwd(), sfiBuildPath, 'index.js')

  let server: Server | null = null

  let serve = async () => {
    const app = await loadApp(filePath)

    if (server) {
      server.stop(true)

      server = null
    }

    if (!server) {
      // @ts-ignore
      server = Bun.serve({...app, port: options.port})

      if (server) {
        // With color
        console.log(
          '\x1b[32m%s\x1b[0m',
          `Listening on http://${server.hostname}:${server.port}`
        )
      }
    }
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
