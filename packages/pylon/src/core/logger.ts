/**
 * The runtime logger (rfcs/RUNTIME_LOGGER.md — Phases 1 & 2).
 *
 * A tiny, zero-dependency, runtime-agnostic structured logger. Distinct from the CLI logger
 * (consola): this one ships in the SERVE graph, so it must stay lean and pull nothing Node-only
 * beyond `async_hooks` (which core already uses for request context). Levels gate cheaply; every
 * emit is a structured `LogRecord` handed to a `sink` (JSON by default, a terse line in dev).
 *
 * Scope: `getLogger()` reads a dedicated `AsyncLocalStorage<Logger>` that the HTTP pipeline (and,
 * later, the queue job runner + outbox relay) bind via `runWithLogger`. Outside a scope it returns
 * the root logger.
 *
 * Phase 2 adds per-TAG levels (`{'*':'info', db:'debug'}` / `LOG_LEVEL=info,db=debug`, most-specific
 * prefix wins) and the `config.logger` object (level/format/base/redact/sink), applied at boot via
 * `configureLogger`. The gate is a tag-aware resolver so `db.debug(...)` can fire while everything
 * else stays at `info`.
 */
import {AsyncLocalStorage} from 'async_hooks'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type LogFields = Record<string, unknown>

export interface LogRecord {
  time: number
  level: LogLevel
  msg: string
  tag?: string
  [key: string]: unknown
}

export interface Logger {
  trace(msg: string, fields?: LogFields): void
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  fatal(msg: string, fields?: LogFields): void
  /** A logger that always carries `bindings` on every record (e.g. `{requestId}`). */
  child(bindings: LogFields): Logger
  /** A logger tagged with a hierarchical component label; composes with `:` (a → a:b). */
  withTag(tag: string): Logger
  /** A logger that ALSO fans each record (at or above `minLevel`, default `info`) to `sink` —
   *  e.g. a BullMQ `job.log`. The primary stdout sink + level gate are unchanged. */
  tee(sink: LogSink, minLevel?: LogLevel): Logger
  /** The effective minimum level for THIS logger's tag (resolved against per-tag config). */
  readonly level: LogLevel
}

const RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
}
const RANK_TO_LEVEL = Object.fromEntries(
  Object.entries(RANK).map(([lvl, rank]) => [rank, lvl])
) as Record<number, LogLevel>

/** Where a built record goes. Default emits JSON to stdout; override for pino/OTel/tests. */
export type LogSink = (record: LogRecord) => void
type Sink = LogSink

/** Default sink: one JSON line. `console` exists on every runtime; no deps. */
const jsonSink: Sink = record => console.log(JSON.stringify(record))

/** Render a record as a single human line (dev format + BullMQ job.log dashboard lines). */
export const renderLine = (record: LogRecord): string => {
  const tag = record.tag ? `[${record.tag}] ` : ''
  return `${record.level.toUpperCase().padEnd(5)} ${tag}${record.msg}${fieldsTail(record)}`
}

/** Minimal dev formatter — inline, no colors/deps; the lazy fallback until the rich one loads. */
const lineSink: Sink = record => console.log(renderLine(record))

// Was this process launched with `--inspect` (Chrome DevTools attaching)? Covers both
// `node --inspect` (execArgv) and `NODE_OPTIONS=--inspect`. No `node:inspector` import → safe on
// every runtime; only consulted on the dev/pretty path anyway.
const inspectorActive = (): boolean =>
  typeof process !== 'undefined' &&
  ((Array.isArray(process.execArgv) && process.execArgv.some(a => a.startsWith('--inspect'))) ||
    (process.env.NODE_OPTIONS ?? '').includes('--inspect'))

/** Auto dev format: DevTools' expandable-object sink when `--inspect`, else the ANSI pretty line. */
const devMode = (): 'devtools' | 'pretty' => (inspectorActive() ? 'devtools' : 'pretty')

// The rich formatters (Phase 5) are a DEV-ONLY module, loaded lazily via a variable specifier so
// production (JSON) never evaluates it. Until it resolves, records use `lineSink`.
const prettyModule = './logger-pretty.js'
const lazyDevSink = (mode: 'pretty' | 'devtools'): Sink => {
  let real: Sink | undefined
  let loading = false
  return record => {
    if (real) return real(record)
    lineSink(record)
    if (!loading) {
      loading = true
      import(prettyModule)
        .then((m: {prettySink: Sink; devtoolsSink: Sink}) => {
          real = mode === 'devtools' ? m.devtoolsSink : m.prettySink
        })
        .catch(() => {
          /* stay on lineSink */
        })
    }
  }
}

const RESERVED = new Set(['time', 'level', 'msg', 'tag'])

/** Render the record's extra fields as ` k=v` for the dev line format. */
function fieldsTail(record: LogRecord): string {
  const parts: string[] = []
  for (const key of Object.keys(record)) {
    if (RESERVED.has(key)) continue
    const value = record[key]
    parts.push(`${key}=${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
  }
  return parts.length ? '  ' + parts.join(' ') : ''
}

/** Errors don't JSON-serialize usefully — flatten to a plain object so they survive the sink. */
const normalize = (value: unknown): unknown =>
  value instanceof Error
    ? {name: value.name, message: value.message, stack: value.stack}
    : value

// ── level resolution (scalar or per-tag map) ───────────────────────────────────

/** Resolves the minimum RANK for a record's tag. */
type LevelResolver = (tag?: string) => number

const scalarResolver = (level: LogLevel): LevelResolver => {
  const rank = RANK[level]
  return () => rank
}

/**
 * Per-tag map: the most-SPECIFIC matching prefix wins (`queue:email` beats `queue` beats `*`).
 * `{'*':'info', db:'debug'}` → `db.debug` fires, `http.debug` doesn't.
 */
const mapResolver = (map: Record<string, LogLevel>): LevelResolver => {
  const def = RANK[map['*'] ?? 'info']
  const ranks: Record<string, number> = {}
  for (const [k, v] of Object.entries(map)) if (v in RANK) ranks[k] = RANK[v]
  return tag => {
    let t = tag
    while (t) {
      if (t in ranks) return ranks[t]
      const i = t.lastIndexOf(':')
      if (i < 0) break
      t = t.slice(0, i)
    }
    return def
  }
}

const resolverFor = (level: LogLevel | Record<string, LogLevel>): LevelResolver =>
  typeof level === 'string' ? scalarResolver(level) : mapResolver(level)

/** Parse `LOG_LEVEL` — a scalar (`info`) or a comma map (`info,db=debug,queue:email=trace`). */
export function parseLevelSpec(spec: string): LogLevel | Record<string, LogLevel> {
  if (!spec.includes(',') && !spec.includes('=')) {
    const l = spec.trim().toLowerCase()
    return (l in RANK ? l : 'info') as LogLevel
  }
  const map: Record<string, LogLevel> = {}
  for (const part of spec.split(',')) {
    const [rawKey, rawVal] = part.includes('=') ? part.split('=') : ['*', part]
    const lvl = rawVal.trim().toLowerCase()
    if (lvl in RANK) map[rawKey.trim()] = lvl as LogLevel
  }
  if (!('*' in map)) map['*'] = 'info'
  return map
}

// ── the logger ─────────────────────────────────────────────────────────────────

interface LoggerState {
  sink: Sink
  tees: {sink: Sink; min: number}[]
  levelFor: LevelResolver
  tag?: string
  bindings: LogFields
}

function makeLogger(state: LoggerState): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (RANK[level] < state.levelFor(state.tag)) return // tag-aware gate, before allocating
    const record: LogRecord = {time: Date.now(), level, msg, ...state.bindings, ...fields}
    for (const key of Object.keys(record)) record[key] = normalize(record[key])
    if (state.tag) record.tag = state.tag
    state.sink(record)
    for (const t of state.tees) if (RANK[level] >= t.min) t.sink(record)
  }
  return {
    trace: (m, f) => emit('trace', m, f),
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    fatal: (m, f) => emit('fatal', m, f),
    child: bindings => makeLogger({...state, bindings: {...state.bindings, ...bindings}}),
    withTag: tag => makeLogger({...state, tag: state.tag ? `${state.tag}:${tag}` : tag}),
    tee: (sink, minLevel) =>
      makeLogger({...state, tees: [...state.tees, {sink, min: RANK[minLevel ?? 'info']}]}),
    get level() {
      return RANK_TO_LEVEL[state.levelFor(state.tag)] ?? 'info'
    }
  }
}

/** Build a logger with an explicit level/sink/tag/bindings (used for the root, config, tests). */
export const createLogger = (
  opts: {
    level?: LogLevel | Record<string, LogLevel>
    sink?: LogSink
    tag?: string
    bindings?: LogFields
  } = {}
): Logger =>
  makeLogger({
    sink: opts.sink ?? jsonSink,
    tees: [],
    levelFor: resolverFor(opts.level ?? 'info'),
    tag: opts.tag,
    bindings: opts.bindings ?? {}
  })

// ── root logger ──────────────────────────────────────────────────────────────

const env = (key: string): string | undefined =>
  typeof process !== 'undefined' ? process.env[key] : undefined

const isDev = (): boolean =>
  typeof process !== 'undefined' &&
  (process.env.NODE_ENV !== 'production' || process.env.PYLON_DEV === '1')

const envOrScalar = (): LogLevel | Record<string, LogLevel> => {
  const spec = env('LOG_LEVEL')
  return spec ? parseLevelSpec(spec) : 'info'
}

let rootLogger: Logger = createLogger({
  level: envOrScalar(),
  sink: isDev() ? lazyDevSink(devMode()) : jsonSink
})

/** The process-wide root logger (used outside any request/job scope). */
export const getRootLogger = (): Logger => rootLogger

/** @internal Replaces the root (used by `configureLogger` and tests). Not part of the public API. */
export const __setRootLogger = (logger: Logger): void => {
  rootLogger = logger
}

// ── request/job scope ─────────────────────────────────────────────────────────

// Its OWN AsyncLocalStorage — the HTTP pipeline, the queue job runner, and the outbox relay all
// bind here. Independent of the Hono `Context` store (jobs have no request) and the DB app-context.
const loggerContext = new AsyncLocalStorage<Logger>()

/** The current scoped logger (request/job), or the root logger outside a scope. */
export const getLogger = (): Logger => loggerContext.getStore() ?? rootLogger

/** Run `fn` with `log` as the active logger for its whole (a)sync execution. */
export const runWithLogger = <T>(log: Logger, fn: () => T): T => loggerContext.run(log, fn)

/**
 * A module-scoped, lazy, tagged logger. Assign it once at the top of a file; it re-resolves the
 * current scoped logger on every call, so it stays correlated AND carries the tag. Prefer this (or
 * `getLogger()` at call time) over capturing `const log = getLogger()` at import — a snapshot taken
 * at module load has no request context.
 */
export const logger = (tag: string): Logger => {
  const resolve = (): Logger => getLogger().withTag(tag)
  return {
    trace: (m, f) => resolve().trace(m, f),
    debug: (m, f) => resolve().debug(m, f),
    info: (m, f) => resolve().info(m, f),
    warn: (m, f) => resolve().warn(m, f),
    error: (m, f) => resolve().error(m, f),
    fatal: (m, f) => resolve().fatal(m, f),
    child: b => resolve().child(b),
    withTag: t => resolve().withTag(t),
    tee: (s, min) => resolve().tee(s, min),
    get level() {
      return resolve().level
    }
  }
}

// ── config (config.logger object form) ─────────────────────────────────────────

export interface LoggerConfig {
  /** A scalar level, or a per-tag map (`{'*':'info', db:'debug'}`). Env `LOG_LEVEL` overrides. */
  level?: LogLevel | Record<string, LogLevel>
  /** `'json'` (prod default) · `'pretty'` (ANSI terminal line) · `'devtools'` (CSS headline + an
   *  expandable record object for Chrome DevTools) · `'auto'` (json in prod; in dev, `devtools`
   *  under `--inspect`, else `pretty`). */
  format?: 'json' | 'pretty' | 'devtools' | 'auto'
  /** Fields added to every record (service, version, region…). */
  base?: LogFields
  /** Dotted paths to mask before the sink (`authorization`, `user.password`). */
  redact?: string[]
  /** Override the destination entirely (pino, OTel, a file, …). Wins over `format`. */
  sink?: LogSink
  /** Queue jobs also tee their logs to BullMQ's persisted per-job log (dashboard). This is its
   *  threshold — separate from stdout — so debug-on-stdout doesn't bloat Redis. Default `info`. */
  job?: {level?: LogLevel}
}

let jobLogLvl: LogLevel = 'info'
/** The threshold for the queue `job.log()` tee (from `config.logger.job.level`). */
export const jobLogLevel = (): LogLevel => jobLogLvl

const sinkForFormat = (format: 'json' | 'pretty' | 'devtools' | 'auto'): Sink =>
  format === 'json'
    ? jsonSink
    : format === 'pretty'
      ? lazyDevSink('pretty')
      : format === 'devtools'
        ? lazyDevSink('devtools')
        : isDev() // 'auto'
          ? lazyDevSink(devMode())
          : jsonSink

/** Wrap a sink so the given dotted paths are masked — copies each level on the path so caller
 *  data is never mutated. */
const redactSink = (paths: string[], sink: Sink): Sink => record => {
  const clone: LogRecord = {...record}
  for (const path of paths) redactPath(clone, path.split('.'))
  sink(clone)
}
function redactPath(root: Record<string, unknown>, segs: string[]): void {
  let node = root
  for (let i = 0; i < segs.length - 1; i++) {
    const next = node[segs[i]]
    if (next == null || typeof next !== 'object') return
    const copy = Array.isArray(next) ? [...next] : {...(next as object)}
    node[segs[i]] = copy
    node = copy as Record<string, unknown>
  }
  const last = segs[segs.length - 1]
  if (last in node) node[last] = '[REDACTED]'
}

/**
 * Apply `config.logger` at boot. `false` → access line off (root unchanged). `true`/absent →
 * defaults. An object → rebuild the root from it. Env (`LOG_LEVEL`, `PYLON_LOG_FORMAT`) overrides
 * so ops can change verbosity/format without a redeploy.
 */
export const configureLogger = (cfg: boolean | LoggerConfig | undefined): void => {
  if (cfg === false) {
    setAccessLog(false)
    return
  }
  setAccessLog(true)
  const obj: LoggerConfig = cfg && typeof cfg === 'object' ? cfg : {}

  const envSpec = env('LOG_LEVEL')
  const level = envSpec ? parseLevelSpec(envSpec) : obj.level ?? 'info'

  const format = (env('PYLON_LOG_FORMAT') as LoggerConfig['format']) ?? obj.format ?? 'auto'
  let sink = obj.sink ?? sinkForFormat(format)
  if (obj.redact?.length) sink = redactSink(obj.redact, sink)

  jobLogLvl = obj.job?.level ?? 'info'

  __setRootLogger(createLogger({level, sink, bindings: obj.base}))
}

// ── access-line toggle (config.logger: false) ──────────────────────────────────

let accessLog = true
/** Enable/disable the per-request access line (wired from `config.logger` at boot). */
export const setAccessLog = (on: boolean): void => {
  accessLog = on
}
export const accessLogEnabled = (): boolean => accessLog
