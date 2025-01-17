import {MiddlewareHandler} from 'hono'
import {getCookie, setCookie, deleteCookie} from 'hono/cookie'
import * as openid from 'openid-client'
import path from 'path'
import {HTTPException} from 'hono/http-exception'
import {ContentfulStatusCode} from 'hono/utils/http-status'
import {env} from 'hono/adapter'
import * as Sentry from '@sentry/bun'
import {existsSync, readFileSync} from 'fs'
import {sendFunctionEvent} from '@getcronit/pylon-telemetry'
import {getEnv} from '../get-env'
import {Env, getContext} from '../context'
import * as crypto from 'crypto'
import {importPrivateKey} from './import-private-key'

export type AuthState = openid.UserInfoResponse & {
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

  const middleware: MiddlewareHandler<Env> = Sentry.startSpan(
    {
      name: 'AuthMiddleware',
      op: 'auth'
    },
    () =>
      async function (ctx, next) {
        const env = getContext().env

        const AUTH_ISSUER = env.AUTH_ISSUER

        if (!AUTH_ISSUER) {
          throw new Error('AUTH_ISSUER is not set')
        }

        if (!API_PRIVATE_KEY_FILE) {
          // If the private key file is not loaded, try to load it from the environment
          const AUTH_KEY = env.AUTH_KEY as string | undefined

          API_PRIVATE_KEY_FILE = AUTH_KEY ? JSON.parse(AUTH_KEY) : undefined
        }

        if (!API_PRIVATE_KEY_FILE) {
          throw new Error(
            'You have initialized the auth middleware without a private key file. Please provide a `key.json` file or set the AUTH_KEY environment variable'
          )
        }

        const openidConfig = await openid.discovery(
          new URL(AUTH_ISSUER),
          API_PRIVATE_KEY_FILE.clientId,
          undefined,
          openid.PrivateKeyJwt({
            key: await importPrivateKey(API_PRIVATE_KEY_FILE.key),
            kid: API_PRIVATE_KEY_FILE.keyId
          })
        )

        let token: string | undefined = undefined

        const authCookie = getCookie(ctx, 'pylon-auth')

        if (ctx.req.header('Authorization')) {
          const authHeader = ctx.req.header('Authorization')

          if (authHeader) {
            const parts = authHeader.split(' ')

            if (parts.length === 2 && parts[0] === 'Bearer') {
              token = parts[1]
            }
          }
        } else if (authCookie) {
          token = authCookie
        }

        if (!token) {
          const queryToken = ctx.req.query('token')

          if (queryToken) {
            token = queryToken
          }
        }

        if (token) {
          const introspection = await openid.tokenIntrospection(
            openidConfig,
            token,
            {
              scope: 'openid email profile'
            }
          )

          console.log(
            'introspection',
            introspection,
            introspection.authorization_details
          )

          if (introspection.active) {
            if (introspection.sub) {
              const auth = await openid.fetchUserInfo(
                openidConfig,
                token,
                introspection.sub
              )

              console.log('Auth:', auth)

              const rolesClaim =
                introspection['urn:zitadel:iam:org:project:roles']

              console.log('urn:zitadel:iam:org:project:roles', rolesClaim)

              const roles: string[] = rolesClaim
                ? Object.keys(rolesClaim.valueOf())
                : []

              ctx.set('auth', {
                user: {
                  active: true,
                  ...auth,
                  roles
                },
                openidConfig
              })
            }
          }
        } else {
          // Remove auth state
          // ctx.set('auth', {active: false})

          // Remove auth cookie
          deleteCookie(ctx, 'pylon-auth')
        }

        if (ctx.req.path === '/auth') {
          const codeVerifier = openid.randomPKCECodeVerifier() // PKCE code verifier
          const codeChallenge = await openid.calculatePKCECodeChallenge(
            codeVerifier
          )

          // Store the code verifier in a secure cookie (not accessible to JavaScript)
          setCookie(ctx, 'pylon_code_verifier', codeVerifier, {
            httpOnly: true,
            maxAge: 300 // 5 minutes
          })

          let scope =
            'openid profile email urn:zitadel:iam:user:resourceowner urn:zitadel:iam:org:projects:roles'

          const parameters: Record<string, string> = {
            scope,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            redirect_uri: new URL(ctx.req.url).origin + '/auth/callback',
            state: openid.randomState()
          }

          const authorizationUrl = openid.buildAuthorizationUrl(
            openidConfig,
            parameters
          )

          return ctx.redirect(authorizationUrl)
        } else if (ctx.req.path === '/auth/callback') {
          const params = ctx.req.query()
          const code = params.code
          const state = params.state

          if (!code || !state) {
            return ctx.text('Missing authorization code or state', 400)
          }

          const codeVerifier = getCookie(ctx, 'pylon_code_verifier')
          if (!codeVerifier) {
            return ctx.text('Missing code verifier', 400)
          }

          try {
            const cbUrl = new URL(ctx.req.url)
            // Exchange the authorization code for tokens
            let tokenSet = await openid.authorizationCodeGrant(
              openidConfig,
              cbUrl,
              {
                pkceCodeVerifier: codeVerifier,
                expectedState: state
              },
              cbUrl.searchParams
            )

            // Store tokens in secure cookies
            setCookie(ctx, `pylon-auth`, tokenSet.access_token, {
              httpOnly: true,
              maxAge: tokenSet.expires_in || 3600 // Default to 1 hour if not specified
            })

            return ctx.redirect('/')
          } catch (error) {
            console.error('Error during token exchange:', error)
            return ctx.text('Authentication failed!', 500)
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
  sendFunctionEvent({
    name: 'authRequire',
    duration: 0
  }).then(() => {})

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

    if (checks.roles && auth.active) {
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

        throw new HTTPException(resError.status as ContentfulStatusCode, {
          res: resError
        })
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
