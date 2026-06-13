/**
 * `useApp(composed, options)` — the runtime that makes a composed set of Apps a
 * live Pylon service. Returns the plugins (in dependency order) that:
 *
 *  1. `useIdentity(provider)` — resolve the request's Principal from any identity
 *     provider and bind it on the request (so capability gates + `getPrincipal`
 *     work, and `ForbiddenError` maps to FORBIDDEN).
 *  2. `useDatabase(...)` — connect + bind the ORM Context from THAT SAME
 *     Principal: tenant scoping and row policies authorize against the actor the
 *     identity provider produced. Runs after (1), so it reads the bound principal.
 *  3. routes — mount each app's Hono routes, each handler GATE-WRAPPED with the
 *     app's `authorize`/`feature` (the REST mirror of the resolver gates in
 *     `compose`), so one app declaration secures GraphQL + REST + ORM alike.
 *
 * Plugin order matters: the loader pushes middleware in array order and the
 * onion chain wraps `next`, so identity → database → handler nests correctly.
 */
import type {Context, Plugin} from '@getcronit/pylon'
import {requireFeature, useDatabase, type UseDatabaseOptions} from '@getcronit/pylon-db'
import {
  getPrincipal,
  useIdentity,
  type IdentityProvider,
  type Principal
} from '@getcronit/pylon-auth'
import type {AppConfig} from './app.js'
import type {Composed} from './compose.js'

const PRINCIPAL_KEY = 'principal'

export interface UseAppOptions {
  /** Resolve the request Principal from any auth mechanism. Drives every gate. */
  identity?: IdentityProvider<Context>
  /** ORM/database options. `principal`/`tenant`/`features` default off the Principal. */
  database?: UseDatabaseOptions
}

/** A Hono handler/middleware: `(c, next) => ...`. */
type Handler = (c: any, next: any) => any

/**
 * Proxy a Hono router so every route the app registers is gate-wrapped, without
 * needing a sub-app: intercept the verb methods and wrap each handler with the
 * app's `authorize`/`feature` check (→ 403 on denial). Non-verb members pass
 * through unchanged.
 */
function gatedRouter(router: any, config: AppConfig): any {
  const {feature, authorize: authz} = config
  if (!feature && !authz) return router
  const VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'all'])

  const gate = (c: any): Response | undefined => {
    const p: Principal | undefined = getPrincipal()
    if (authz && !authz(p)) return c.json({error: 'Forbidden'}, 403)
    if (feature) {
      try {
        requireFeature(feature) // reads features from the ORM Context (bound by useDatabase)
      } catch {
        return c.json({error: 'Forbidden', feature}, 403)
      }
    }
    return undefined
  }

  return new Proxy(router, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && VERBS.has(prop)) {
        return (path: string, ...handlers: Handler[]) =>
          target[prop](
            path,
            ...handlers.map(
              (h): Handler =>
                async (c, next) => {
                  const denied = gate(c)
                  if (denied) return denied
                  return h(c, next)
                }
            )
          )
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}

export function useApp(composed: Composed<any>, options: UseAppOptions = {}): Plugin[] {
  const plugins: Plugin[] = []

  // 1. Identity → request Principal (set on the Hono context, mapped errors).
  if (options.identity) plugins.push(useIdentity(options.identity))

  // 2. Database/ORM Context bound from the SAME Principal (unless overridden).
  const readPrincipal = (c: any) => c.get(PRINCIPAL_KEY) as Principal | undefined
  plugins.push(
    useDatabase({
      ...options.database,
      principal: options.database?.principal ?? readPrincipal,
      tenant: options.database?.tenant ?? (c => readPrincipal(c)?.tenant),
      features:
        options.database?.features ??
        (c => readPrincipal(c)?.attributes?.features as readonly string[] | undefined)
    })
  )

  // 3. Mount each app's routes, gate-wrapped with its authorize/feature.
  plugins.push({
    setup(app: any) {
      for (const a of composed.apps) {
        if (!a.__routes.length) continue
        const router = gatedRouter(app, a.config)
        for (const register of a.__routes) register(router)
      }
    }
  })

  return plugins
}
