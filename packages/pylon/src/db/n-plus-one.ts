// General N+1 advisory (dev-only, zero prod overhead).
//
// Counts, per request, how many times the SAME ORM read fires from the SAME call
// site, and warns ONCE past a threshold — reported in ORM terms (`Model.op() from
// file:line`), not raw SQL. Catches N+1 from any UN-BATCHED read: `.objects` queries
// in a loop, per-owner relations, a relation `.first()` per parent, etc.
//
// When the repeated calls differ only in ONE top-level equality column's VALUE, it
// also names that column as the `batchKey()` target — the precise, actionable half of
// the old count-only hint, now available for every terminal. Batched reads (keyed
// hasMany, batchKey() counts, batched M2M) run ONE query for N parents, so they're
// noted at most once and never warn. Never changes behaviour; scoped per request
// (GC'd with it); ignores CLI/seed.
import {boundContextKey} from './app-context.js'
import {getModelDefinition} from './registry.js'

/** A WHERE fragment — a plain object of column → value/predicate. Typed loosely here
 *  to avoid importing the ORM's WhereInput (and a module cycle); we only read keys. */
type WhereFragment = Record<string, unknown>

const ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.PYLON_BATCH_HINTS === '1'
const THRESHOLD = Math.max(2, Number(process.env.PYLON_NPLUS1_THRESHOLD ?? 12))

const INTERNAL =
  /[/\\]pylon-db[/\\](dist|src)[/\\]|[/\\]node_modules[/\\](kysely|pg)[/\\]|node:internal/

type Rec = {
  count: number
  warned: boolean
  /** Distinct values seen per top-level equality column across the repeats. */
  eqs: Map<string, Set<unknown>>
}
const perRequest = new WeakMap<object, Map<string, Rec>>()

/** First stack frame outside pylon-db/driver/node — `path:line`, or '' if none. */
function callSite(): string {
  const stack = new Error().stack
  if (!stack) return ''
  for (const line of stack.split('\n').slice(2)) {
    if (INTERNAL.test(line) || line.includes('n-plus-one')) continue
    const m = line.match(/\(?([^()\s]+:\d+):\d+\)?\s*$/)
    if (m) return m[1]
  }
  return ''
}

/** Top-level scalar-equality columns in the WHERE (the only shape a batchKey() can
 *  coalesce), validated against the model's real columns. */
function equalities(
  model: Function,
  where?: ReadonlyArray<WhereFragment>
): Record<string, unknown> {
  if (!where?.length) return {}
  const def = getModelDefinition(model as any)
  if (!def) return {}
  const eq: Record<string, unknown> = {}
  for (const frag of where)
    for (const [k, v] of Object.entries(frag ?? {}))
      if (
        (v === null || typeof v !== 'object') &&
        def.columns.some(c => c.propertyKey === k)
      )
        eq[k] = v
  return eq
}

/** The single equality column whose value VARIED across the repeats → the batchKey()
 *  target (batchKey marks the key that changes per iteration). '' when ambiguous. */
function batchKeyHint(rec: Rec): string {
  const varying = [...rec.eqs].filter(([, vals]) => vals.size > 1).map(([c]) => c)
  return varying.length === 1 ? ` — e.g. \`batchKey()\` on \`${varying[0]}\`` : ''
}

/** Note one UN-BATCHED ORM read (called from the QuerySet / M2M terminals). */
export function noteQuery(
  model: Function,
  op: string,
  where?: ReadonlyArray<WhereFragment>
): void {
  if (!ENABLED) return
  const ctx = boundContextKey()
  if (!ctx) return // CLI/seed/startup — not a request
  const site = callSite()
  const key = `${model.name}.${op}@${site}`
  let bucket = perRequest.get(ctx)
  if (!bucket) perRequest.set(ctx, (bucket = new Map()))
  let rec = bucket.get(key)
  if (!rec) bucket.set(key, (rec = {count: 0, warned: false, eqs: new Map()}))
  rec.count++
  for (const [col, val] of Object.entries(equalities(model, where))) {
    let set = rec.eqs.get(col)
    if (!set) rec.eqs.set(col, (set = new Set()))
    set.add(val)
  }
  if (rec.count >= THRESHOLD && !rec.warned) {
    rec.warned = true
    // eslint-disable-next-line no-console
    console.warn(
      `[pylon-db:n+1] ${rec.count}× ${model.name}.${op}()` +
        (site ? ` from ${site}` : '') +
        ` in one request — likely an N+1. Batch it${batchKeyHint(rec)} (or one query ` +
        `over all ids / a per-request cache).`
    )
  }
}
