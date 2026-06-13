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
import {
  currentPrincipal,
  definePolicy,
  getModelDefinition,
  type ModelCtor,
  type WhereInput
} from '@getcronit/pylon-db'
import {ForbiddenError, getPrincipal, type Principal} from '@getcronit/pylon-auth'
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

/** Builder callback signature for `can`/`cannot`. */
export type AbilityRule = (
  action: string | string[],
  subject: Subject | Subject[],
  conditions?: WhereInput<any>
) => void

/** Declares the rules for a principal. Run per request with the current actor. */
export type AbilitiesFn = (
  principal: Principal | undefined,
  can: AbilityRule,
  cannot: AbilityRule
) => void

let abilitiesFn: AbilitiesFn | undefined

/** Resolve a subject arg to its canonical name (class → name, instance → ctor name). */
function subjectName(s: SubjectArg): string {
  if (typeof s === 'string') return s
  if (typeof s === 'function') return s.name
  return (s as object).constructor?.name ?? ''
}

/** Run the ability fn for a principal, collecting rules (+ the model classes seen). */
function buildRules(principal: Principal | undefined): {
  rules: Rule[]
  classes: Map<string, ModelCtor<any>>
} {
  const rules: Rule[] = []
  const classes = new Map<string, ModelCtor<any>>()
  const record =
    (inverted: boolean): AbilityRule =>
    (action, subject, conditions) => {
      const actions = Array.isArray(action) ? action : [action]
      const subjects = Array.isArray(subject) ? subject : [subject]
      for (const s of subjects) {
        const name = subjectName(s)
        if (typeof s === 'function') classes.set(name, s)
        for (const a of actions) rules.push({action: a, subject: name, conditions, inverted})
      }
    }
  abilitiesFn?.(principal, record(false), record(true))
  return {rules, classes}
}

/** The actor to authorize against: the request Principal, else the ORM-bound one. */
function currentActor(): Principal | undefined {
  return getPrincipal() ?? (currentPrincipal() as Principal | undefined)
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
  abilitiesFn = fn
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
      create: ({principal}) => canFor(principal as Principal | undefined, 'create', ctor)
    })
  }
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
