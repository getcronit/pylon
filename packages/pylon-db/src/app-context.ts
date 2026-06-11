/**
 * Ambient app context — the current tenant + enabled features for the active
 * request or job. Pylon-db owns this ALS so the data layer stays standalone; the
 * `useDatabase()` plugin populates it per request from the app's session, and the
 * queue runtime populates it per job. Tenant auto-scoping (manager) and feature
 * gating both read from here.
 */
import {AsyncLocalStorage} from 'node:async_hooks'

export interface AppContext {
  /** Current tenant id (e.g. organizationId). Undefined = no tenant bound. */
  tenant?: string | number
  /** Features enabled for the current tenant (for feature gating). */
  features?: readonly string[]
  /** The authenticated principal (session/user) — read by row-level policies. */
  principal?: unknown
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

/** The features enabled for the current tenant (empty if none bound). */
export function currentFeatures(): readonly string[] {
  return appContext.getStore()?.features ?? []
}

/** The authenticated principal for the active request/job, or undefined. */
export function currentPrincipal(): unknown {
  return appContext.getStore()?.principal
}

/** The bound context's object identity (a stable singleton when none is bound).
 *  Per-request caches (e.g. relation batchers) key on this so concurrent
 *  requests on a shared connection never share a batch. */
export function appContextKey(): object {
  return appContext.getStore() ?? NO_CONTEXT
}
