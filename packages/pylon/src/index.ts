export {defineService, ServiceError, PylonAPI} from './define-pylon.js'
export {logger} from './logger/index.js'
export {getContext, getInfo} from './utils.js'
export * from './auth/index.js'
export {Context, Env} from './context.js'

import * as Sentry from '@sentry/bun'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  integrations: [...Sentry.autoDiscoverNodePerformanceMonitoringIntegrations()],
  normalizeDepth: 10,
  tracesSampleRate: 1
})
