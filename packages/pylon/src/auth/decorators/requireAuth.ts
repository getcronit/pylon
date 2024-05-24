import {ServiceError} from '../../define-pylon'
import {AuthRequireChecks, auth} from '..'
import {HTTPException} from 'hono/http-exception'
import {getContext} from '../../context'

export function requireAuth(checks?: AuthRequireChecks) {
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

  return function fn(...args: any[]) {
    const target: any = args[0]
    const propertyKey: string = args[1]
    const descriptor: PropertyDescriptor = args[2]

    if (descriptor) {
      const originalMethod = descriptor.value

      descriptor.value = async function (...args: any[]) {
        await checkAuth(getContext())

        return originalMethod.apply(this, args)
      }
    } else {
      Object.defineProperty(target, propertyKey, {
        get: async function () {
          await checkAuth(getContext())

          return this._value
        },
        set: function (newValue) {
          this._value = newValue
        }
      })
    }
  }
}
