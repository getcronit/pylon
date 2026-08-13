/**
 * In-memory `WhereInput` matcher — the net-new piece the resource ability layer
 * needs that the ORM didn't have: evaluate a `WhereInput` against an already-
 * loaded instance (for `can(action, instance)` / field checks), mirroring the
 * SQL compiler's operator semantics so a row that the DB filter would return is
 * exactly the row this returns `true` for.
 *
 * Scope: scalar field operators + AND/OR/NOT. RELATION predicates (belongsTo
 * nesting, some/every/none) are NOT evaluable without loading the relation, so
 * they're rejected here (use `filter()` at the query layer, which compiles them
 * to correlated EXISTS). This is the documented B2 boundary.
 */
import type {WhereInput} from './manager.js'

/** Thrown when an instance check hits a condition that can't be evaluated in memory. */
export class AbilityMatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbilityMatchError'
  }
}

const FIELD_OPERATORS = new Set([
  'equals',
  'not',
  'in',
  'notIn',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'startsWith',
  'endsWith',
  'mode'
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    (v.constructor === Object || Object.getPrototypeOf(v) === null)
  )
}

function matchField(actual: any, ops: Record<string, unknown>): boolean {
  const insensitive = ops.mode === 'insensitive'
  const norm = (s: unknown) =>
    insensitive && typeof s === 'string' ? s.toLowerCase() : s
  for (const [op, v] of Object.entries(ops)) {
    if (v === undefined) continue
    switch (op) {
      case 'equals':
        if (norm(actual) !== norm(v)) return false
        break
      case 'not':
        if (norm(actual) === norm(v)) return false
        break
      case 'in':
        if (!(v as any[]).map(norm).includes(norm(actual))) return false
        break
      case 'notIn':
        if ((v as any[]).map(norm).includes(norm(actual))) return false
        break
      case 'lt':
        if (!(actual < (v as any))) return false
        break
      case 'lte':
        if (!(actual <= (v as any))) return false
        break
      case 'gt':
        if (!(actual > (v as any))) return false
        break
      case 'gte':
        if (!(actual >= (v as any))) return false
        break
      case 'contains':
        if (typeof actual !== 'string' || !(norm(actual) as string).includes(norm(v) as string))
          return false
        break
      case 'startsWith':
        if (typeof actual !== 'string' || !(norm(actual) as string).startsWith(norm(v) as string))
          return false
        break
      case 'endsWith':
        if (typeof actual !== 'string' || !(norm(actual) as string).endsWith(norm(v) as string))
          return false
        break
      case 'mode':
        break // handled via `insensitive`
    }
  }
  return true
}

/** True iff `row` satisfies `where` (scalar + logical only; relations rejected). */
export function matchWhere<T extends object>(row: T, where: WhereInput<T>): boolean {
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (value === undefined) continue
    if (key === 'AND') {
      const arr = Array.isArray(value) ? value : [value]
      if (!arr.every(w => matchWhere(row, w as WhereInput<T>))) return false
      continue
    }
    if (key === 'OR') {
      const arr = value as WhereInput<T>[]
      if (!arr.some(w => matchWhere(row, w))) return false // empty OR ⇒ matches nothing
      continue
    }
    if (key === 'NOT') {
      const arr = Array.isArray(value) ? value : [value]
      if (arr.some(w => matchWhere(row, w as WhereInput<T>))) return false
      continue
    }
    if (isPlainObject(value)) {
      const keys = Object.keys(value)
      if (keys.length > 0 && keys.every(k => FIELD_OPERATORS.has(k))) {
        if (!matchField((row as any)[key], value)) return false
      } else {
        throw new AbilityMatchError(
          `Instance-level can() cannot evaluate a relation/nested condition on "${key}"; ` +
            `use filter() at the query layer (it compiles relations to SQL EXISTS).`
        )
      }
    } else if ((row as any)[key] !== value) {
      // bare scalar equality
      return false
    }
  }
  return true
}
