import {Server} from 'bun'

export {default as makeApp} from './make-app.js'

class Runtime {
  accessLog: Map<string, string> = new Map()

  #server: Server | null = null

  get server() {
    this.accessLog.set(Date.now().toString(), 'Get server')

    return this.#server || ({} as Server)
  }

  set server(server: Server) {
    this.accessLog.set(Date.now().toString(), 'Set server')

    this.#server = server
  }
}

export const runtime = new Runtime()

import * as Sentry from '@sentry/bun'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  integrations: [
    Sentry.bunServerIntegration(),
    // Sentry.anrIntegration({captureStackTrace: true}),
    Sentry.prismaIntegration(),
    Sentry.graphqlIntegration({
      ignoreResolveSpans: false,
      ignoreTrivalResolveSpans: false
    })
  ],
  normalizeDepth: 10,
  tracesSampleRate: 1
})
