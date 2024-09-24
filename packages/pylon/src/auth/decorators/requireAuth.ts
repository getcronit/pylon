import {sendFunctionEvent} from '@getcronit/pylon-telemetry'
import {HTTPException} from 'hono/http-exception'

import {AuthRequireChecks, auth} from '..'
import {getContext} from '../../context'
import {ServiceError} from '../../define-pylon'
import {createDecorator} from '../../create-decorator'

export function requireAuth(checks?: AuthRequireChecks) {
  sendFunctionEvent({
    name: 'requireAuth',
    duration: 0
  }).then(() => {})

  const checkAuth = async (c: any) => {
    const ctx = await c

    try {
      await auth.require(checks)(ctx, async () => {})
    } catch (e) {
      if (e instanceof HTTPException) {
        if (e.status === 401) {
          throw new ServiceError(e.message, {
            statusCode: 401,
            code: 'AUTH_REQUIRED'
          })
        } else if (e.status === 403) {
          const res = e.getResponse()

          throw new ServiceError(res.statusText, {
            statusCode: res.status,
            code: 'AUTHORIZATION_REQUIRED',
            details: {
              missingRoles: res.headers.get('Missing-Roles')?.split(','),
              obtainedRoles: res.headers.get('Obtained-Roles')?.split(',')
            }
          })
        } else {
          throw e
        }
      }

      throw e
    }
  }

  return createDecorator(async () => {
    const ctx = getContext()

    await checkAuth(ctx)
  })
}
