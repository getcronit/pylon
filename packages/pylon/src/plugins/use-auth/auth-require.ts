import {MiddlewareHandler} from 'hono'
import {env} from 'hono/adapter'
import {HTTPException} from 'hono/http-exception'
import {ContentfulStatusCode} from 'hono/utils/http-status'
import {ServiceError} from '../../define-pylon'
import {Env, getContext} from '../../context'
import {createDecorator} from '../../create-decorator'

export type AuthRequireChecks = {
  roles?: string[]
}

export const authMiddleware = (checks: AuthRequireChecks = {}) => {
  const middleware: MiddlewareHandler<Env> = async (ctx, next) => {
    const AUTH_PROJECT_ID = env(ctx).AUTH_PROJECT_ID

    // Check if user is authenticated
    const auth = ctx.get('auth')

    if (!auth) {
      throw new HTTPException(401, {
        message: 'Authentication required'
      })
    }

    if (checks.roles && auth.user) {
      const roles = auth.user.roles

      const hasRole = checks.roles.some(role => {
        return (
          roles.includes(role) || roles.includes(`${AUTH_PROJECT_ID}:${role}`)
        )
      })

      if (!hasRole) {
        const resError = new Response('Forbidden', {
          status: 403,
          statusText: 'Forbidden',
          headers: {
            'Missing-Roles': checks.roles.join(','),
            'Obtained-Roles': roles.join(',')
          }
        })

        throw new HTTPException(resError.status as ContentfulStatusCode, {
          res: resError
        })
      }
    }

    return next()
  }

  return middleware
}

export function requireAuth(checks?: AuthRequireChecks) {
  const checkAuth = async (c: any) => {
    const ctx = await c

    try {
      await authMiddleware(checks)(ctx, async () => {})
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
