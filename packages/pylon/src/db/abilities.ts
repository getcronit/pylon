/**
 * Resource-tier authorization — the second authz tier (capability tier lives in
 * pylon-auth). ONE declarative rule set (`defineAbilities`) projected two ways:
 *
 *  - a boolean DECISION: `can(action, resourceOrInstance, field?)` /
 *    `authorize(...)` / `cannot(...)` — for instance + field checks in resolvers.
 *  - a `WhereInput` FILTER: `filter(action, subject)` — for query scoping, fed
 *    into the ORM through the EXISTING row-policy seam (`definePolicy`), so
 *    `Model.objects` auto-scopes and writes auto-authorize with zero new ORM code.
 *
 * Rules are CASL-shaped: `can/cannot(action, subject, conditions?)`. `action` may
 * be `'manage'` (any action); `subject` may be a model class, a string, or
 * `'all'` (any subject). `conditions` is a `WhereInput<T>` (RBAC via roles in the
 * builder; ABAC via conditions over principal attributes). A matching `cannot`
 * denies. ReBAC (OpenFGA/SpiceDB) slots in later behind the same two projections.
 */
import {currentPrincipal} from './app-context.js'
import {definePolicy} from './policies.js'
import {getModelDefinition} from './registry.js'
import type {ModelCtor, WhereInput} from './manager.js'
import {ForbiddenError} from './features.js'
import type {Principal} from '@getcronit/pylon/auth/contract'
import {matchWhere} from './matcher.js'

const MANAGE = 'manage'
const ALL = 'all'

type Subject = string | ModelCtor<any>
type SubjectArg = Subject | object // a model class, a subject name, or an instance

interface Rule {
  action: string
  subject: string
  conditions?: WhereInput<any>
  fields?: string[]
  inverted: boolean
}

/** Returned by `can`/`cannot` — chain `.stamp()` to set server-owned columns on create. */
export interface AbilityRuleResult {
  /**
   * Stamp a to-be-created instance (the `onCreate` replacement). The fn closes over
   * the principal from the builder, so `doc => { doc.ownerId = p.id }` just works.
   */
  stamp(fn: (instance: any) => void): AbilityRuleResult
}

/** Builder callback signature for `can`/`cannot`. */
export type AbilityRule = (
  action: string | string[],
  subject: Subject | Subject[],
  conditions?: WhereInput<any>
) => AbilityRuleResult

/** Declares the rules for a principal. Run per request with the current actor. */
export type AbilitiesFn = (
  principal: Principal | undefined,
  can: AbilityRule,
  cannot: AbilityRule
) => void

// ACCUMULATE: each app registers its own rules; all run together. (Single-global
// would let the last app's `defineAbilities` clobber the others in a multi-app
// service.) Cross-app isolation holds because rules match by subject.
const abilitiesFns: AbilitiesFn[] = []

/** Resolve a subject arg to its canonical name (class → name, instance → ctor name). */
function subjectName(s: SubjectArg): string {
  if (typeof s === 'string') return s
  if (typeof s === 'function') return s.name
  return (s as object).constructor?.name ?? ''
}

/** Run the ability fn for a principal, collecting rules, model classes, and stamps. */
function buildRules(principal: Principal | undefined): {
  rules: Rule[]
  classes: Map<string, ModelCtor<any>>
  stamps: Map<string, ((instance: any) => void)[]>
} {
  const rules: Rule[] = []
  const classes = new Map<string, ModelCtor<any>>()
  const stamps = new Map<string, ((instance: any) => void)[]>()
  const record =
    (inverted: boolean): AbilityRule =>
    (action, subject, conditions) => {
      const subjects = Array.isArray(subject) ? subject : [subject]
      const actions = Array.isArray(action) ? action : [action]
      const names: string[] = []
      for (const s of subjects) {
        const name = subjectName(s)
        names.push(name)
        if (typeof s === 'function') classes.set(name, s)
        for (const a of actions) rules.push({action: a, subject: name, conditions, inverted})
      }
      const result: AbilityRuleResult = {
        stamp(fn) {
          for (const name of names) {
            const list = stamps.get(name) ?? stamps.set(name, []).get(name)!
            list.push(fn)
          }
          return result
        }
      }
      return result
    }
  for (const fn of abilitiesFns) fn(principal, record(false), record(true))
  return {rules, classes, stamps}
}

/** The actor to authorize against: the request Principal, else the ORM-bound one. */
function currentActor(): Principal | undefined {
  return currentPrincipal() as Principal | undefined
}

/** Rules relevant to (action, subject): subject/action match incl. `all`/`manage`. */
function relevantRules(rules: Rule[], action: string, subject: string): Rule[] {
  return rules.filter(
    r =>
      (r.subject === subject || r.subject === ALL) &&
      (r.action === action || r.action === MANAGE)
  )
}

function canFor(
  principal: Principal | undefined,
  action: string,
  resource: SubjectArg,
  field?: string
): boolean {
  const {rules} = buildRules(principal)
  const subject = subjectName(resource)
  const isInstance = typeof resource === 'object' && resource !== null
  let allowed = false
  for (const r of relevantRules(rules, action, subject)) {
    if (field && r.fields && !r.fields.includes(field)) continue
    // Conditions are checked against an INSTANCE; at the subject level (class/
    // string) there's no row, so a conditioned rule is treated as "potentially".
    const matches = isInstance && r.conditions ? matchWhere(resource as object, r.conditions) : true
    if (!matches) continue
    if (r.inverted) return false // an explicit, matching `cannot` denies
    allowed = true
  }
  return allowed
}

/**
 * The row filter for (action, subject): `false` = deny all, `true` = allow all,
 * else a `WhereInput`. Shaped to drop straight into a `FilterRule`.
 */
function filterFor(
  principal: Principal | undefined,
  action: string,
  subject: SubjectArg
): WhereInput<any> | boolean {
  const {rules} = buildRules(principal)
  const relevant = relevantRules(rules, action, subjectName(subject))
  const allows = relevant.filter(r => !r.inverted)
  const denies = relevant.filter(r => r.inverted)
  if (allows.length === 0) return false // nothing grants it → deny all
  const allowAll = allows.some(r => !r.conditions)
  const allowWhere: WhereInput<any> | boolean = allowAll
    ? true
    : {OR: allows.map(r => r.conditions!)}
  if (denies.length === 0) return allowWhere
  // AND NOT each deny condition (a conditionless `cannot` ⇒ deny all).
  if (denies.some(r => !r.conditions)) return false
  const notDenies = denies.map(r => ({NOT: r.conditions!}) as WhereInput<any>)
  return allowWhere === true ? {AND: notDenies} : {AND: [allowWhere, ...notDenies]}
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register the resource ability rules. Also auto-wires the ORM: every model
 * class referenced by a rule gets a `definePolicy` whose read/update/delete
 * filters and create gate are computed from the abilities for the request's
 * principal — so `Model.objects` scopes and writes authorize automatically.
 *
 * NOTE: a model is governed if a rule REFERENCES its class (discovered by running
 * the rules once at registration). Reference subjects unconditionally (branch the
 * CONDITIONS on the principal, not the `can` call); or pass `subjects` explicitly.
 */
export function defineAbilities(fn: AbilitiesFn, options: {subjects?: ModelCtor<any>[]} = {}): void {
  abilitiesFns.push(fn)
  const governed = new Map<string, ModelCtor<any>>(buildRules(undefined).classes)
  for (const ctor of options.subjects ?? []) governed.set(ctor.name, ctor)
  for (const [, ctor] of governed) {
    // Only ORM models get a row policy; non-model subjects (strings, domain
    // concepts) still work for can()/filter() but have no table to scope.
    if (!getModelDefinition(ctor)) continue
    definePolicy(ctor, {
      read: ({principal}) => filterFor(principal as Principal | undefined, 'read', ctor),
      update: ({principal}) => filterFor(principal as Principal | undefined, 'update', ctor),
      delete: ({principal}) => filterFor(principal as Principal | undefined, 'delete', ctor),
      create: ({principal}) => canFor(principal as Principal | undefined, 'create', ctor),
      // onCreate runs the create-rule stamps for this subject (the `.stamp()` form),
      // so server-owned columns are set at the data layer — never trusted from input.
      onCreate: ({principal}, instance) => {
        for (const fn of buildRules(principal as Principal | undefined).stamps.get(ctor.name) ?? []) {
          fn(instance)
        }
      }
    })
  }
}

/** Per-model `can`/`cannot` — the subject is the model itself, so it's omitted. */
export type ModelAbilityRule<T = any> = (
  action: string | string[],
  conditions?: WhereInput<T>
) => AbilityRuleResult

/** Signature of a model's co-located `static abilities`. */
export type ModelAbilitiesFn<T = any> = (
  principal: Principal | undefined,
  can: ModelAbilityRule<T>,
  cannot: ModelAbilityRule<T>
) => void

/**
 * Wire a model's CO-LOCATED `static abilities(p, can, cannot)` into the resource-authz
 * machinery, with the subject pre-bound to that model. Equivalent to `defineAbilities`
 * scoped to one class — so a model governs itself with no `{subjects}` footgun (the
 * subject is implicit, and the class is always registered as governed). Called by the
 * `@model()` decorator when a `static abilities` is present.
 */
export function registerModelAbilities(Ctor: ModelCtor<any>, fn: ModelAbilitiesFn): void {
  defineAbilities(
    (principal, can, cannot) => {
      fn(
        principal,
        (action, conditions) => can(action, Ctor, conditions),
        (action, conditions) => cannot(action, Ctor, conditions)
      )
    },
    {subjects: [Ctor]}
  )
}

/** True iff the current principal may perform `action` on the resource (+ field). */
export function can(action: string, resource: SubjectArg, field?: string): boolean {
  return canFor(currentActor(), action, resource, field)
}

/** Negation of `can` (CASL parity) — readable guards: `if (cannot('update', doc)) …`. */
export function cannot(action: string, resource: SubjectArg, field?: string): boolean {
  return !can(action, resource, field)
}

/** The row filter for (action, subject) for the current principal. */
export function filter(action: string, subject: SubjectArg): WhereInput<any> | boolean {
  return filterFor(currentActor(), action, subject)
}

// `authorize` is OVERLOADED: the capability form (a principal predicate) OR the
// resource form (action + resource/instance). One verb, both tiers —
// `authorize(p => …)` and `authorize('update', doc)`. Both resolve the actor the
// same way (request principal, else the ORM-bound one), so the verb behaves
// consistently in resolvers, routes, and non-Hono contexts (e.g. queue jobs).
export function authorize(check: (principal: Principal | undefined) => boolean): void
export function authorize(action: string, resource: SubjectArg, field?: string): void
export function authorize(
  a: string | ((principal: Principal | undefined) => boolean),
  resource?: SubjectArg,
  field?: string
): void {
  if (typeof a === 'function') {
    if (!a(currentActor())) throw new ForbiddenError()
    return
  }
  if (!can(a, resource as SubjectArg, field)) {
    throw new ForbiddenError(`Not permitted to ${a} ${subjectName(resource as SubjectArg)}.`)
  }
}
