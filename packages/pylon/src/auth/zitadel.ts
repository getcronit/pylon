/**
 * @getcronit/pylon-auth/zitadel — the Zitadel/OIDC integration.
 *
 * THE provider behind the identity seam. `zitadelAuth()` is an `IdentityProvider`
 * that introspects the request's token (Bearer header / `?token` / `pylon-auth`
 * cookie) against the OIDC issuer and returns a `Principal` DIRECTLY — there is
 * no intermediate `AuthState` and core never sees it. Drive every authz tier with
 * `useApp({identity: zitadelAuth({issuer})})` (or `useIdentity(zitadelAuth(...))`).
 *
 * `zitadelLogin()` adds the browser OAuth routes (`/auth/login|callback|logout`)
 * that set the session cookie `zitadelAuth()` then reads. API-only services using
 * Bearer tokens don't need it.
 *
 * Opt-in subpath: importing this is what pulls `openid-client` in — the core auth
 * path (Principal + capability gates) stays dependency-light.
 */
import {promises as fs} from 'fs'
import path from 'path'
import * as crypto from 'crypto'
import {deleteCookie, getCookie, setCookie} from 'hono/cookie'
import {HTTPException} from 'hono/http-exception'
import * as openid from 'openid-client'
import {getContext, type Context, type Plugin} from '@getcronit/pylon'
import type {IdentityProvider, Principal} from './principal.js'

/** The OIDC user info Zitadel returns (already carries arbitrary claims). */
export type OidcUser = openid.UserInfoResponse

export interface ZitadelOptions {
  /** OIDC issuer URL, e.g. `https://acme.zitadel.cloud`. */
  issuer: string
  /** Service-account key file (PKCS1 PEM JSON). Default `key.json`; or env `AUTH_KEY`. */
  keyPath?: string
}

export interface ZitadelAuthOptions extends ZitadelOptions {
  /** Override the principal id (default: the OIDC `sub`). */
  id?: (user: OidcUser) => string | number
  /** Derive the tenant id (e.g. org) from the claims (default: none). */
  tenant?: (user: OidcUser) => string | number | undefined
  /** Fine-grained permissions, if your claims carry them (default: none). */
  permissions?: (user: OidcUser) => readonly string[]
  /** Attributes for ABAC rules (default: all claims). */
  attributes?: (user: OidcUser) => Record<string, unknown>
}

// ── OIDC bootstrap (shared by the provider + the login routes) ───────────────

type AuthKey = {keyId: string; key: string; clientId: string}

const loadAuthKey = async (keyPath: string): Promise<AuthKey> => {
  const envKey = (getContext().env as unknown as Record<string, string | undefined>).AUTH_KEY
  if (envKey) {
    try {
      return JSON.parse(envKey)
    } catch {
      throw new Error('Error reading AUTH_KEY. Make sure it is valid JSON.')
    }
  }
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), keyPath), 'utf-8'))
  } catch {
    throw new Error(`Error reading key file "${keyPath}". Make sure it exists and is valid JSON.`)
  }
}

function str2ab(str: string) {
  const buf = new ArrayBuffer(str.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < str.length; i++) view[i] = str.charCodeAt(i)
  return buf
}

const importPrivateKey = async (pkcs1Pem: string) => {
  const pkcs8 = crypto.createPrivateKey(pkcs1Pem).export({type: 'pkcs8', format: 'pem'}) as string
  const body = pkcs8.substring(
    '-----BEGIN PRIVATE KEY-----'.length,
    pkcs8.length - '-----END PRIVATE KEY-----'.length - 1
  )
  return crypto.subtle.importKey(
    'pkcs8',
    str2ab(atob(body)),
    {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'},
    true,
    ['sign']
  )
}

const configCache = new Map<string, Promise<openid.Configuration>>()

function bootstrap(issuer: string, keyPath: string): Promise<openid.Configuration> {
  const cached = configCache.get(issuer)
  if (cached) return cached
  const built = (async () => {
    const authKey = await loadAuthKey(keyPath)
    return openid.discovery(
      new URL(issuer),
      authKey.clientId,
      undefined,
      openid.PrivateKeyJwt({key: (await importPrivateKey(authKey.key)) as any, kid: authKey.keyId})
    )
  })()
  configCache.set(issuer, built)
  return built
}

/** Pull the bearer/query/cookie token off the request. */
function readToken(c: Context): string | undefined {
  const header = c.req.header('Authorization')
  if (header) {
    const [type, value] = header.split(' ')
    if (type === 'Bearer') return value
  }
  return c.req.query('token') ?? getCookie(c, 'pylon-auth')
}

// ── The identity provider: token → Principal ─────────────────────────────────

/** Pure claims → Principal mapping (exported for testing without an OIDC server). */
export function zitadelPrincipal(
  sub: string,
  roles: string[],
  user: OidcUser,
  options: ZitadelAuthOptions
): Principal {
  return {
    id: options.id?.(user) ?? sub,
    tenant: options.tenant?.(user),
    roles,
    permissions: options.permissions?.(user) ?? [],
    attributes: options.attributes?.(user) ?? (user as Record<string, unknown>)
  }
}

export function zitadelAuth(options: ZitadelAuthOptions): IdentityProvider<Context> {
  const keyPath = options.keyPath ?? 'key.json'
  return async c => {
    const token = readToken(c)
    if (!token) return undefined // public request
    const config = await bootstrap(options.issuer, keyPath)
    const introspection = await openid.tokenIntrospection(config, token, {
      scope: 'openid email profile'
    })
    if (!introspection.active || !introspection.sub) return undefined
    const user = (await openid.fetchUserInfo(config, token, introspection.sub)) as OidcUser
    const roles = Object.keys(introspection['urn:zitadel:iam:org:projects:roles']?.valueOf() || {})
    return zitadelPrincipal(introspection.sub, roles, user, options)
  }
}

// ── The browser OAuth login routes ───────────────────────────────────────────

export function zitadelLogin(options: ZitadelOptions & {endpoint?: string}): Plugin {
  const {issuer, endpoint = '/auth'} = options
  const keyPath = options.keyPath ?? 'key.json'
  return {
    setup(app) {
      app.get(`${endpoint}/login`, async c => {
        const config = await bootstrap(issuer, keyPath)
        const codeVerifier = openid.randomPKCECodeVerifier()
        const codeChallenge = await openid.calculatePKCECodeChallenge(codeVerifier)
        setCookie(c, 'pylon_code_verifier', codeVerifier, {httpOnly: true, maxAge: 300})
        const url = openid.buildAuthorizationUrl(config, {
          scope:
            'openid profile email urn:zitadel:iam:user:resourceowner urn:zitadel:iam:org:projects:roles',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          redirect_uri: new URL(c.req.url).origin + `${endpoint}/callback`,
          state: openid.randomState()
        })
        return c.redirect(url)
      })

      app.get(`${endpoint}/logout`, async c => {
        deleteCookie(c, 'pylon-auth')
        return c.redirect('/')
      })

      app.get(`${endpoint}/callback`, async c => {
        const config = await bootstrap(issuer, keyPath)
        const {code, state} = c.req.query()
        if (!code || !state) {
          throw new HTTPException(400, {message: 'Missing authorization code or state'})
        }
        const codeVerifier = getCookie(c, 'pylon_code_verifier')
        if (!codeVerifier) throw new HTTPException(400, {message: 'Missing code verifier'})
        const cbUrl = new URL(c.req.url)
        const tokens = await openid.authorizationCodeGrant(
          config,
          cbUrl,
          {pkceCodeVerifier: codeVerifier, expectedState: state},
          cbUrl.searchParams
        )
        setCookie(c, 'pylon-auth', tokens.access_token, {
          httpOnly: true,
          maxAge: tokens.expires_in || 3600
        })
        return c.redirect('/')
      })
    }
  }
}
