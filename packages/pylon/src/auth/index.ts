import {MiddlewareHandler} from 'hono'
import jwt from 'jsonwebtoken'
import type {IdTokenClaims, IntrospectionResponse} from 'openid-client'
import path from 'path'
import {HTTPException} from 'hono/http-exception'
import {StatusCode} from 'hono/utils/http-status'
import {env} from 'hono/adapter'
import * as Sentry from '@sentry/bun'
import {existsSync, readFileSync} from 'fs'
import {sendFunctionEvent} from '@getcronit/pylon-telemetry'

export type AuthState = IntrospectionResponse &
  IdTokenClaims & {
    roles: string[]
  }

const authInitialize = () => {
  // Load private key file from cwd
  const authKeyFilePath = path.join(process.cwd(), 'key.json')

  // Load private key file from cwd
  let API_PRIVATE_KEY_FILE:
    | {
        type: 'application'
        keyId: string
        key: string
        appId: string
        clientId: string
      }
    | undefined = undefined

  if (existsSync(authKeyFilePath)) {
    try {
      API_PRIVATE_KEY_FILE = JSON.parse(readFileSync(authKeyFilePath, 'utf-8'))
    } catch (error) {
      throw new Error(
        'Error while reading key file. Make sure it is valid JSON'
      )
    }
  }

  const middleware: MiddlewareHandler<{
    Variables: {
      auth: AuthState
    }
  }> = Sentry.startSpan(
    {
      name: 'AuthMiddleware',
      op: 'auth'
    },
    () =>
      async function (ctx, next) {
        const AUTH_ISSUER = env(ctx).AUTH_ISSUER

        if (!AUTH_ISSUER) {
          throw new Error('AUTH_ISSUER is not set')
        }

        if (!API_PRIVATE_KEY_FILE) {
          // If the private key file is not loaded, try to load it from the environment
          const AUTH_KEY = env(ctx).AUTH_KEY as string | undefined

          API_PRIVATE_KEY_FILE = AUTH_KEY ? JSON.parse(AUTH_KEY) : undefined
        }

        if (!API_PRIVATE_KEY_FILE) {
          throw new Error(
            'You have initialized the auth middleware without a private key file'
          )
        }

        const AUTH_PROJECT_ID = env(ctx).AUTH_PROJECT_ID

        const ZITADEL_INTROSPECTION_URL = `${AUTH_ISSUER}/oauth/v2/introspect`

        async function getRolesFromToken(tokenString: string) {
          const response = await fetch(
            `${AUTH_ISSUER}/auth/v1/usergrants/me/_search`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tokenString}`
              }
            }
          )

          const data = (await response.json()) as any

          const userRoles = (data.result?.map((grant: any) => {
            return (grant.roles || []).map((role: any) => {
              return `${grant.projectId}:${role}`
            })
          }) || []) as string[][]

          const projectScopedRoles = userRoles.flat()

          const rolesSet = new Set(projectScopedRoles)

          // Add unscoped roles based on project id
          // This is useful so that it is not necessary to specify the project id for every role check
          if (AUTH_PROJECT_ID) {
            for (const role of projectScopedRoles) {
              const [projectId, ...roleNameParts] = role.split(':')

              const roleName = roleNameParts.join(':')

              if (projectId === AUTH_PROJECT_ID) {
                rolesSet.add(roleName)
              }
            }
          }

          return Array.from(rolesSet)
        }

        async function introspectToken(
          tokenString: string
        ): Promise<AuthState> {
          if (!API_PRIVATE_KEY_FILE) {
            throw new Error('Internal error: API_PRIVATE_KEY_FILE is not set')
          }

          // Create JWT for client assertion
          const payload = {
            iss: API_PRIVATE_KEY_FILE.clientId,
            sub: API_PRIVATE_KEY_FILE.clientId,
            aud: AUTH_ISSUER,
            exp: Math.floor(Date.now() / 1000) + 60 * 60, // Expires in 1 hour
            iat: Math.floor(Date.now() / 1000)
          }

          const headers = {
            alg: 'RS256',
            kid: API_PRIVATE_KEY_FILE.keyId
          }
          const jwtToken = jwt.sign(payload, API_PRIVATE_KEY_FILE.key, {
            algorithm: 'RS256',
            header: headers
          })

          const scopeSet = new Set<string>()

          scopeSet.add('openid')
          scopeSet.add('profile')
          scopeSet.add('email')

          if (AUTH_PROJECT_ID) {
            scopeSet.add(
              `urn:zitadel:iam:org:project:id:${AUTH_PROJECT_ID}:aud`
            )
          }

          const scope = Array.from(scopeSet).join(' ')

          // Send introspection request
          const body = new URLSearchParams({
            client_assertion_type:
              'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            client_assertion: jwtToken,
            token: tokenString,
            scope
          }).toString()

          try {
            const response = await fetch(ZITADEL_INTROSPECTION_URL, {
              method: 'POST',
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              body
            })

            if (!response.ok) {
              throw new Error('Network response was not ok')
            }

            const tokenData = (await response.json()) as IntrospectionResponse

            const roles = await getRolesFromToken(tokenString)

            const state = {
              ...tokenData,
              roles
            } as AuthState

            return state
          } catch (error) {
            console.error('Error while introspecting token', error)
            throw new Error('Token introspection failed')
          }
        }

        let token: string | undefined = undefined

        if (ctx.req.header('Authorization')) {
          const authHeader = ctx.req.header('Authorization')

          if (authHeader) {
            const parts = authHeader.split(' ')

            if (parts.length === 2 && parts[0] === 'Bearer') {
              token = parts[1]
            }
          }
        }

        if (!token) {
          const queryToken = ctx.req.query('token')

          if (queryToken) {
            token = queryToken
          }
        }

        if (token) {
          const auth = await introspectToken(token)

          if (auth.active) {
            ctx.set('auth', auth)

            Sentry.setUser({
              id: auth.sub,
              username: auth.preferred_username,
              email: auth.email,
              details: auth
            })
          }
        }

        return next()
      }
  )

  sendFunctionEvent({
    name: 'authInitialize',
    duration: 0
  }).then(() => {})

  return middleware
}

export type AuthRequireChecks = {
  roles?: string[]
}

const authRequire = (checks: AuthRequireChecks = {}) => {
  const middleware: MiddlewareHandler<{
    Variables: {
      auth?: AuthState
    }
  }> = async (ctx, next) => {
    const AUTH_PROJECT_ID = env(ctx).AUTH_PROJECT_ID

    // Check if user is authenticated
    const auth = ctx.get('auth')

    if (!auth) {
      throw new HTTPException(401, {
        message: 'Authentication required'
      })
    }

    if (checks.roles) {
      const roles = auth.roles

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

        throw new HTTPException(resError.status as StatusCode, {res: resError})
      }
    }

    return next()
  }

  sendFunctionEvent({
    name: 'authRequire',
    duration: 0
  }).then(() => {})

  return middleware
}

export const auth = {
  initialize: authInitialize,
  require: authRequire
}

export {requireAuth} from './decorators/requireAuth'
