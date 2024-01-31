import {MiddlewareHandler} from 'hono'
import {generators} from 'openid-client'
import jwt from 'jsonwebtoken'
import {IdTokenClaims, IntrospectionResponse, Issuer} from 'openid-client'
import path from 'path'
import {HTTPException} from 'hono/http-exception'
import {env} from 'hono/adapter'

export type AuthState = IntrospectionResponse & IdTokenClaims

const authInitialize = () => {
  // Load private key file from cwd
  const name = path.join(process.cwd(), 'key.json')

  // Load private key file from cwd
  const API_PRIVATE_KEY_FILE: {
    type: 'application'
    keyId: string
    key: string
    appId: string
    clientId: string
  } = require(name)

  const AUTH_ISSUER = process.env.AUTH_ISSUER

  if (!AUTH_ISSUER) {
    throw new Error('AUTH_ISSUER is not set')
  }

  const AUTH_ORG_ID = process.env.AUTH_ORG_ID

  const middleware: MiddlewareHandler<{
    Variables: {
      auth: AuthState
    }
  }> = async function (ctx, next) {
    // Check authorization header
    const authorizationHeader = ctx.req.header('Authorization')

    const issuer = await Issuer.discover(AUTH_ISSUER)

    const ZITADEL_INTROSPECTION_URL = issuer.metadata
      .introspection_endpoint as string

    async function introspectToken(tokenString: string): Promise<AuthState> {
      // Create JWT for client assertion
      const payload = {
        iss: API_PRIVATE_KEY_FILE.clientId,
        sub: API_PRIVATE_KEY_FILE.clientId,
        aud: issuer.metadata.issuer,
        exp: Math.floor(Date.now() / 1000) + 60 * 60, // Expires in 1 hour
        iat: Math.floor(Date.now() / 1000)
      }

      console.log('Payload: ', payload)

      const headers = {
        alg: 'RS256',
        kid: API_PRIVATE_KEY_FILE.keyId
      }
      const jwtToken = jwt.sign(payload, API_PRIVATE_KEY_FILE.key, {
        algorithm: 'RS256',
        header: headers
      })

      // Send introspection request
      const body = new URLSearchParams({
        client_assertion_type:
          'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: jwtToken,
        token: tokenString
      }).toString()

      try {
        console.log(ZITADEL_INTROSPECTION_URL)
        const response = await fetch(ZITADEL_INTROSPECTION_URL, {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body
        })

        if (!response.ok) {
          throw new Error('Network response was not ok')
        }

        const tokenData = await response.json()
        console.log(
          `Token data from introspection: ${JSON.stringify(tokenData)}`
        )
        return tokenData as AuthState
      } catch (error) {
        console.error('Error while introspecting token', error)
        throw new Error('Token introspection failed')
      }
    }

    if (
      authorizationHeader &&
      authorizationHeader.toLowerCase().startsWith('bearer ')
    ) {
      const token = authorizationHeader.substring(7)

      // Verify token and get claims

      const state = await introspectToken(token)

      if (state.active) {
        if (AUTH_ORG_ID) {
          if (state['urn:zitadel:iam:user:resourceowner:id'] === AUTH_ORG_ID) {
            ctx.set('auth', state)
          }
        } else {
          ctx.set('auth', state)
        }
      }
    }

    return next()
  }

  return middleware
}

const authRequire: MiddlewareHandler<{
  Variables: {
    auth?: AuthState
  }
}> = async (ctx, next) => {
  // Check if user is authenticated
  const auth = ctx.get('auth')

  if (auth) {
    return next()
  }

  return new Response('Authentication required', {status: 401})
}

export const auth = {
  initialize: authInitialize,
  require: authRequire
}
