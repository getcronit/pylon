/**
 * Ambient app context — the current tenant + enabled features for the active
 * request or job. Pylon-db owns this ALS so the data layer stays standalone; the
 * `useDatabase()` plugin populates it per request from the app's session, and the
 * queue runtime populates it per job. Tenant auto-scoping (manager) and feature
 * gating both read from here.
 */
import {AsyncLocalStorage} from 'node:async_hooks'

/** A feature can be a boolean switch OR carry a value (a limit/quota or a variant). */
export type FeatureValue = boolean | number | string
/** The resolved feature state for a tenant: flag → on/off or a value. Absent = off. */
export type FeatureState = Record<string, FeatureValue>

export interface AppContext {
  /** Current tenant id (e.g. organizationId). Undefined = no tenant bound. */
  tenant?: string | number
  /**
   * Features for the current tenant: a `FeatureState` (flag → value/bool) or a bare
   * `string[]` of enabled flags (sugar for `{flag: true}`). Bound per request by the
   * feature provider; read via `requireFeature`/`isFeatureEnabled`/`featureValue`.
   */
  features?: FeatureState | readonly string[]
  /** The authenticated principal (session/user) — read by row-level policies. */
  principal?: unknown
  /** Trusted/system scope: bypasses tenant scoping AND row-level policies for
   *  every op inside (reads, writes, creates). Set via `runAsSystem`. */
  system?: boolean
}

const appContext = new AsyncLocalStorage<AppContext>()

/** Stable identity for "no bound context" (CLI/jobs) so per-request caches that
 *  key on the context still have a singleton to group under. */
const NO_CONTEXT: AppContext = {}

/** Run `fn` with the given app context bound (request/job scope). */
export function runWithAppContext<T>(ctx: AppContext, fn: () => T): T {
  return appContext.run(ctx, fn)
}

/** The bound app context (empty object if none). */
export function getAppContext(): AppContext {
  return appContext.getStore() ?? {}
}

/** The current tenant id, or undefined if none is bound. */
export function currentTenant(): string | number | undefined {
  return appContext.getStore()?.tenant
}

/** The resolved feature state (flag → value/bool), normalizing the `string[]` sugar. */
export function currentFeatureState(): FeatureState {
  const f = appContext.getStore()?.features
  if (!f) return {}
  if (Array.isArray(f)) {
    const state: FeatureState = {}
    for (const flag of f) state[flag] = true
    return state
  }
  return f as FeatureState
}

/** The ENABLED feature flags for the current tenant (truthy values). Back-compat. */
export function currentFeatures(): readonly string[] {
  const state = currentFeatureState()
  return Object.keys(state).filter(k => !!state[k])
}

/** The authenticated principal for the active request/job, or undefined. */
export function currentPrincipal(): unknown {
  return appContext.getStore()?.principal
}

/** True inside `runAsSystem` — trusted scope that bypasses tenant + policy. */
export function isSystem(): boolean {
  return appContext.getStore()?.system === true
}

/**
 * Run `fn` as TRUSTED SYSTEM code: tenant auto-scoping and row-level policies are
 * bypassed for every op inside (reads, writes, AND creates) — the global twin of
 * `.unscoped()`, which only covers a single query and not `create`. For seeding,
 * crons, login-time audit writes, admin tasks. Preserves the bound tenant/principal
 * (so explicit values still resolve); only lifts enforcement.
 */
export function runAsSystem<T>(fn: () => T): T {
  return appContext.run({...getAppContext(), system: true}, fn)
}

/** The bound context's object identity (a stable singleton when none is bound).
 *  Per-request caches (e.g. relation batchers) key on this so concurrent
 *  requests on a shared connection never share a batch. */
export function appContextKey(): object {
  return appContext.getStore() ?? NO_CONTEXT
}
