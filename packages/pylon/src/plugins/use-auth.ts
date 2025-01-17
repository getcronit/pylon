import * as openid from 'openid-client'
import {auth, getContext, getEnv, type Plugin} from '../index'
import path from 'path'
import {promises as fs} from 'fs'
import {importPrivateKey} from '../auth/import-private-key'
import {deleteCookie, getCookie, setCookie} from 'hono/cookie'
import {HTTPException} from 'hono/http-exception'

type AuthKey = {
  type: 'application'
  keyId: string
  key: string
  appId: string
  clientId: string
}

export type AuthState = {
  user?: openid.UserInfoResponse & {
    roles: string[]
  }

  openidConfig: openid.Configuration
}

const loadAuthKey = async (keyPath: string): Promise<AuthKey> => {
  const authKeyFilePath = path.join(process.cwd(), keyPath)

  const env = getContext().env

  if (env.AUTH_KEY) {
    try {
      return JSON.parse(env.AUTH_KEY)
    } catch (error) {
      throw new Error(
        'Error while reading AUTH_KEY. Make sure it is valid JSON'
      )
    }
  }

  try {
    const ketFileContent = await fs.readFile(authKeyFilePath, 'utf-8')

    try {
      return JSON.parse(ketFileContent)
    } catch (error) {
      throw new Error(
        'Error while reading key file. Make sure it is valid JSON'
      )
    }
  } catch (error) {
    throw new Error('Error while reading key file. Make sure it exists')
  }
}

let openidConfigCache: openid.Configuration | undefined

const bootstrapAuth = async (issuer: string, keyPath: string) => {
  if (!openidConfigCache) {
    const authKey = await loadAuthKey(keyPath)

    openidConfigCache = await openid.discovery(
      new URL(issuer),
      authKey.clientId,
      undefined,
      openid.PrivateKeyJwt({
        key: await importPrivateKey(authKey.key),
        kid: authKey.keyId
      })
    )
  }

  return openidConfigCache
}

class PylonAuthException extends HTTPException {
  // Same constructor as HTTPException
  constructor(...args: ConstructorParameters<typeof HTTPException>) {
    // Prefix the message with "PylonAuthException: "
    args[1] = {
      ...args[1],
      message: `PylonAuthException: ${args[1]?.message}`
    }

    super(...args)
  }
}

export function useAuth(args: {
  issuer: string
  endpoint?: string
  keyPath?: string
}): Plugin {
  const {issuer, endpoint = '/auth', keyPath = 'key.json'} = args

  const loginPath = `${endpoint}/login`
  const logoutPath = `${endpoint}/logout`
  const callbackPath = `${endpoint}/callback`

  return {
    middleware: async (ctx, next) => {
      const openidConfig = await bootstrapAuth(issuer, keyPath)

      ctx.set('auth', {
        openidConfig
      })

      // Introspect token
      const authCookieToken = getCookie(ctx, 'pylon-auth')
      const authHeader = ctx.req.header('Authorization')
      const authQueryToken = ctx.req.query('token')

      if (authCookieToken || authHeader || authQueryToken) {
        let token: string | undefined

        if (authHeader) {
          const [type, value] = authHeader.split(' ')
          if (type === 'Bearer') {
            token = value
          }
        } else if (authQueryToken) {
          token = authQueryToken
        } else if (authCookieToken) {
          token = authCookieToken
        }

        if (!token) {
          throw new PylonAuthException(401, {
            message: 'Invalid token'
          })
        }

        const introspection = await openid.tokenIntrospection(
          openidConfig,
          token,
          {
            scope: 'openid email profile'
          }
        )

        if (!introspection.active) {
          throw new PylonAuthException(401, {
            message: 'Token is not active'
          })
        }

        if (!introspection.sub) {
          throw new PylonAuthException(401, {
            message: 'Token is missing subject'
          })
        }

        // Fetch user info
        const userInfo = await openid.fetchUserInfo(
          openidConfig,
          token,
          introspection.sub
        )

        const roles = Object.keys(
          introspection['urn:zitadel:iam:org:projects:roles']?.valueOf() || {}
        )

        ctx.set('auth', {
          user: {
            ...userInfo,
            roles
          },
          openidConfig
        })

        return next()
      }
    },
    app(app) {
      app.get(loginPath, async ctx => {
        const openidConfig = ctx.get('auth').openidConfig

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
      })

      app.get(logoutPath, async ctx => {
        // Remove auth cookie
        deleteCookie(ctx, 'pylon-auth')

        return ctx.redirect('/')
      })

      app.get(callbackPath, async ctx => {
        const openidConfig = ctx.get('auth').openidConfig

        const params = ctx.req.query()
        const code = params.code
        const state = params.state

        if (!code || !state) {
          throw new PylonAuthException(400, {
            message: 'Missing authorization code or state'
          })
        }

        const codeVerifier = getCookie(ctx, 'pylon_code_verifier')
        if (!codeVerifier) {
          throw new PylonAuthException(400, {
            message: 'Missing code verifier'
          })
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
      })
    }
  }
}
