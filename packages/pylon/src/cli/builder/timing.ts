/**
 * Lightweight, process-global build-timing collector.
 *
 * Opt-in via `PYLON_TIMING=1` (the `pylon build --timing` flag sets it), so it is zero
 * overhead on normal builds. Stages span several modules (cli → builder → pages build),
 * so the collector is a module singleton shared by import.
 *
 * Spans nest by start order and are printed as an indented tree with durations, plus a
 * self-time column so a parent's own overhead (total minus timed children) is visible.
 * Parallel spans (e.g. the client + server page builds) appear at the same depth with
 * overlapping windows — the report notes wall vs summed time so that reads correctly.
 */
export const timingEnabled = (): boolean =>
  process.env.PYLON_TIMING === '1' || process.env.PYLON_TIMING === 'true'

interface Span {
  name: string
  ms: number
  start: number
  end: number
}

const spans: Span[] = []

/** Begin a span; returns its end function (idempotent). Nesting is derived at report
 *  time from the time windows, so this is concurrency-safe: parallel spans render as
 *  siblings of the stage that contains them, not nested in each other. */
export function span(name: string): () => void {
  if (!timingEnabled()) return () => {}
  const s: Span = {name, start: performance.now(), end: 0, ms: 0}
  spans.push(s)
  let ended = false
  return () => {
    if (ended) return
    ended = true
    s.end = performance.now()
    s.ms = s.end - s.start
  }
}

/** Time an async (or sync) stage. */
export async function time<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const end = span(name)
  try {
    return await fn()
  } finally {
    end()
  }
}

/** Record an already-measured duration (for work timed elsewhere, e.g. a plugin hook). */
export function record(name: string, ms: number): void {
  if (!timingEnabled()) return
  const end = performance.now()
  spans.push({name, ms, start: end - ms, end})
}

export function reset(): void {
  spans.length = 0
}

const contains = (c: Span, s: Span): boolean =>
  c !== s &&
  c.start <= s.start + 0.01 &&
  c.end >= s.end - 0.01 &&
  c.ms > s.ms + 0.01 // a container is strictly longer, so equal windows don't loop

/**
 * A span's nesting depth. Normally the count of spans that temporally contain it —
 * but two parallel tasks overlap, and the longer one's window envelops the shorter,
 * which would falsely nest them. So spans inside a span whose name marks it parallel
 * are pulled up to be its direct children (a flat view of the concurrent section).
 */
function depthOf(s: Span, all: Span[]): number {
  const parallelParents = all.filter(c => contains(c, s) && /parallel/i.test(c.name))
  if (parallelParents.length) {
    // tightest (shortest) parallel container → one level below it
    const tightest = parallelParents.reduce((a, b) => (a.ms <= b.ms ? a : b))
    return all.filter(c => contains(c, tightest)).length + 1
  }
  return all.filter(c => contains(c, s)).length
}

const fmt = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`

/** Print the collected spans as an indented tree; nesting derived by time containment. */
export function report(title = 'pylon build timing'): void {
  if (!timingEnabled() || spans.length === 0) return
  const done = spans.filter(s => s.end > 0)
  if (done.length === 0) return
  const withDepth = done.map(s => ({...s, depth: depthOf(s, done)}))
  const ordered = withDepth.sort((a, b) => a.start - b.start || b.ms - a.ms)
  const wall = Math.max(...done.map(s => s.end)) - Math.min(...done.map(s => s.start))

  const labelWidth = Math.min(
    64,
    Math.max(...ordered.map(s => s.name.length + s.depth * 2)) + 2
  )
  const lines = ordered.map(s => {
    const indent = '  '.repeat(s.depth)
    const label = (indent + s.name).padEnd(labelWidth)
    // Direct children (depth+1, contained in this window) → self time.
    const childMs = ordered
      .filter(
        c =>
          c !== s &&
          c.depth === s.depth + 1 &&
          c.start >= s.start - 0.01 &&
          c.end <= s.end + 0.01
      )
      .reduce((a, c) => a + c.ms, 0)
    const self = s.ms - childMs
    // Skip self-time for parallel parents: their children overlap, so the difference
    // isn't meaningful (can even go negative).
    const selfCol = childMs > 0.5 && self > 0.5 ? `  (self ${fmt(self)})` : ''
    return `  ${label} ${fmt(s.ms).padStart(8)}${selfCol}`
  })

  // eslint-disable-next-line no-console
  console.log(
    `\n⏱  ${title} — wall ${fmt(wall)}\n` +
      lines.join('\n') +
      `\n   (elapsed time; siblings at the same indent may run in parallel — compare to wall)\n`
  )
}
