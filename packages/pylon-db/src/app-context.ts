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
}

const appContext = new AsyncLocalStorage<AppContext>()

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
