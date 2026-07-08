// General N+1 advisory (dev-only, zero prod overhead).
//
// Counts, per request, how many times the SAME ORM read fires from the SAME call
// site, and warns ONCE past a threshold. Reported in ORM terms — `Model.op() from
// file:line` — because that's what you write, not raw SQL. Catches N+1 from any
// UN-BATCHED read: `.objects` queries in a loop, per-owner M2M relations, a relation
// `.first()` per parent, etc.
//
// It's placed at the ORM terminals that run one-query-per-call. Batched reads (keyed
// hasMany, batchKey() counts, batched M2M) execute a SINGLE query for N parents from
// their coalescing loader, so they're noted at most once and never warn — the tool
// rewards batching. Never changes behaviour; scoped per request (GC'd with it);
// ignores CLI/seed so the shared context can't accumulate false positives.
import {boundContextKey} from './app-context.js'

const ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.PYLON_BATCH_HINTS === '1'
const THRESHOLD = Math.max(2, Number(process.env.PYLON_NPLUS1_THRESHOLD ?? 12))

// Frames inside the ORM / driver / node — skipped to surface the CALLER's line.
const INTERNAL =
  /[/\\]pylon-db[/\\](dist|src)[/\\]|[/\\]node_modules[/\\](kysely|pg)[/\\]|node:internal/

type Rec = {count: number; warned: boolean}
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

/** Note one UN-BATCHED ORM read. Called from the QuerySet / M2M terminals that run a
 *  query per call — so batched paths (one query for N parents) note at most once. */
export function noteQuery(model: {name: string}, op: string): void {
  if (!ENABLED) return
  const ctx = boundContextKey()
  if (!ctx) return // CLI/seed/startup — not a request
  const site = callSite()
  const key = `${model.name}.${op}@${site}`
  let bucket = perRequest.get(ctx)
  if (!bucket) perRequest.set(ctx, (bucket = new Map()))
  let rec = bucket.get(key)
  if (!rec) bucket.set(key, (rec = {count: 0, warned: false}))
  rec.count++
  if (rec.count >= THRESHOLD && !rec.warned) {
    rec.warned = true
    // eslint-disable-next-line no-console
    console.warn(
      `[pylon-db:n+1] ${rec.count}× ${model.name}.${op}()` +
        (site ? ` from ${site}` : '') +
        ` in one request — likely an N+1. Batch it: batchKey() on the relation, one ` +
        `query over all ids, or a per-request cache.`
    )
  }
}
