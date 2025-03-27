import {asyncContext, Context} from './context'

export function getEnv() {
  const start = Date.now()
  const skipTracing = arguments[0] === true

  try {
    const context = asyncContext.getStore() as Context

    // Fall back to process.env or an empty object if no context is available
    // This is useful for testing
    // ref: https://hono.dev/docs/guides/testing#env
    const ctx = context.env || process.env || {}

    ctx.NODE_ENV = ctx.NODE_ENV || process.env.NODE_ENV || 'development'

    return ctx
  } catch {
    return process.env
  } finally {
    if (!skipTracing) {
    }
  }
}
