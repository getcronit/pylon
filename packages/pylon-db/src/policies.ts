/**
 * Row-level authorization policies. A policy maps a model + action to a filter:
 * the ORM AND-s it into every query/write automatically (the same mechanism as
 * tenant auto-scoping), so authorization is enforced at the data layer and can't
 * be forgotten in a resolver.
 *
 *   definePolicy(Note, {
 *     read:   ({principal}) => principal?.role === 'ADMIN' ? {} : {ownerId: principal?.userId},
 *     update: ({principal}) => ({ownerId: principal?.userId}),     // a row that doesn't match → ForbiddenError
 *     create: ({principal}) => !!principal,                        // no row yet → boolean gate
 *     onCreate: ({principal}, note) => { note.ownerId = principal.userId }, // stamp ownership
 *   })
 *
 * Division of labor: the framework (`requireRole`, `app.gate`, `requireFeature`)
 * gates the API surface (which operations/fields). Policies gate the DATA (which
 * rows). The two compose.
 *
 * - `read` is AND-ed into SELECT / count / paginate, AND into relation loads
 *   (so traversal can't leak rows you couldn't query directly).
 * - `update` / `delete` are AND-ed into the corresponding write's WHERE; a
 *   targeted row that doesn't match yields a `ForbiddenError`.
 * - `create` is a boolean gate (there's no row to filter); `onCreate` stamps
 *   server-owned columns (e.g. ownerId) so they're never trusted from input.
 *
 * A rule returning a `WhereInput<T>` scopes; `true` allows all; `false` denies
 * all. With `@model({secure: true})`, an action with NO rule denies (fail
 * closed); otherwise an action with no rule is unrestricted.
 */
import {currentFeatures, getAppContext} from './app-context.js'
import {getModelDefinitionOrThrow, type ModelDefinition} from './registry.js'
// Type-only (erased) — avoids a runtime import cycle with manager.ts.
import type {WhereInput} from './manager.js'

/** Everything a policy rule can branch on. */
export interface PolicyContext {
  /** The authenticated principal bound via `useDatabase({principal})` (or undefined). */
  principal: unknown
  /** The bound tenant id, if any. */
  tenant?: string | number
  /** Features enabled for the current tenant. */
  features: readonly string[]
}

/** A read/update/delete rule: scope (`WhereInput`), allow-all (`true`), deny-all (`false`). */
export type FilterRule<T> = (ctx: PolicyContext) => WhereInput<T> | boolean
/** A create rule: a boolean gate (there is no row to filter yet). */
export type CreateRule = (ctx: PolicyContext) => boolean

export interface ModelPolicy<T> {
  read?: FilterRule<T>
  update?: FilterRule<T>
  delete?: FilterRule<T>
  create?: CreateRule
  /** Mutate a to-be-created instance (e.g. stamp `ownerId` from the principal). */
  onCreate?: (ctx: PolicyContext, instance: T) => void
}

/** Action whose rule is a row filter (everything except create). */
export type FilterAction = 'read' | 'update' | 'delete'

const policies = new WeakMap<ModelDefinition, ModelPolicy<any>>()

/** Register the row-level policy for a model (colocate with the model, like signals). */
export function definePolicy<T extends object>(
  model: {new (): T},
  policy: ModelPolicy<T>
): void {
  policies.set(getModelDefinitionOrThrow(model), policy as ModelPolicy<any>)
}

export function getPolicy(def: ModelDefinition): ModelPolicy<any> | undefined {
  return policies.get(def)
}

/**
 * An app-wide DEFAULT policy (via `models.app(name, {policy})`). Applies to every
 * model in the app for any action a per-model `definePolicy` doesn't cover — so
 * "the common case" (e.g. "must be an authenticated org member"; tenant scoping
 * draws the org boundary) is declared ONCE, and only the exceptions (credentials,
 * owned rows, admin-only) need their own rule. A bare function is the rule for
 * read/update/delete and a create gate (non-`false` ⇒ allowed).
 */
export type AppPolicy = ModelPolicy<any> | FilterRule<any>

const appPolicies = new Map<string, ModelPolicy<any>>()

export function defineAppPolicy(app: string, policy: AppPolicy): void {
  appPolicies.set(
    app,
    typeof policy === 'function'
      ? {read: policy, update: policy, delete: policy, create: ctx => policy(ctx) !== false}
      : policy
  )
}

export function getAppPolicy(app: string | undefined): ModelPolicy<any> | undefined {
  return app ? appPolicies.get(app) : undefined
}

/** Snapshot the ambient context for a rule. */
export function policyContext(): PolicyContext {
  const ctx = getAppContext()
  // `currentFeatures()` normalizes the feature state to the enabled-flag names.
  return {principal: ctx.principal, tenant: ctx.tenant, features: currentFeatures()}
}
