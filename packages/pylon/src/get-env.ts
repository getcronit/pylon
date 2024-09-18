import {sendFunctionEvent} from '@getcronit/pylon-telemetry'
import {asyncContext, Context} from './context'

export function getEnv() {
  const start = Date.now()
  const skipTracing = arguments[0] === true

  try {
    const context = asyncContext.getStore() as Context
    return context.env
  } catch {
    return process.env
  } finally {
    if (!skipTracing) {
      sendFunctionEvent({
        name: 'getEnv',
        duration: Date.now() - start
      }).then(() => {})
    }
  }
}
