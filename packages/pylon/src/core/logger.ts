/**
 * The runtime logger (rfcs/RUNTIME_LOGGER.md — Phase 1).
 *
 * A tiny, zero-dependency, runtime-agnostic structured logger. Distinct from the CLI logger
 * (consola): this one ships in the SERVE graph, so it must stay lean and pull nothing Node-only
 * beyond `async_hooks` (which core already uses for request context). Levels gate cheaply; every
 * emit is a structured `LogRecord` handed to a `sink` (JSON by default, a terse line in dev).
 *
 * Scope: `getLogger()` reads a dedicated `AsyncLocalStorage<Logger>` that the HTTP pipeline (and,
 * later, the queue job runner + outbox relay) bind via `runWithLogger`. Outside a scope it returns
 * the root logger. Phase 2 adds per-tag levels + the `config.logger` object; this file already
 * carries a `tag` so those are additive.
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
  /** Effective minimum level; calls below it are a cheap no-op. */
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

/** Where a built record goes. Default emits JSON to stdout; override for pino/OTel/tests. */
export type LogSink = (record: LogRecord) => void
type Sink = LogSink

/** Default sink: one JSON line. `console` exists on every runtime; no deps. */
const jsonSink: Sink = record => console.log(JSON.stringify(record))

/** Minimal dev formatter — inline, no colors/deps (the rich pretty printer is Phase 5). */
const lineSink: Sink = record => {
  const tag = record.tag ? `[${record.tag}] ` : ''
  console.log(`${record.level.toUpperCase().padEnd(5)} ${tag}${record.msg}${fieldsTail(record)}`)
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

interface LoggerState {
  sink: Sink
  level: LogLevel
  minRank: number
  tag?: string
  bindings: LogFields
}

function makeLogger(state: LoggerState): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (RANK[level] < state.minRank) return // gate before allocating the record
    const record: LogRecord = {time: Date.now(), level, msg, ...state.bindings, ...fields}
    for (const key of Object.keys(record)) record[key] = normalize(record[key])
    if (state.tag) record.tag = state.tag
    state.sink(record)
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
    get level() {
      return state.level
    }
  }
}

/** Build a logger with an explicit level/sink/tag/bindings (used for the root, config, tests). */
export const createLogger = (
  opts: {level?: LogLevel; sink?: LogSink; tag?: string; bindings?: LogFields} = {}
): Logger => {
  const level = opts.level ?? 'info'
  return makeLogger({
    sink: opts.sink ?? jsonSink,
    level,
    minRank: RANK[level],
    tag: opts.tag,
    bindings: opts.bindings ?? {}
  })
}

// ── root logger ──────────────────────────────────────────────────────────────

const envLevel = (): LogLevel => {
  const v =
    typeof process !== 'undefined' ? process.env.LOG_LEVEL?.toLowerCase() : undefined
  return v && v in RANK ? (v as LogLevel) : 'info'
}

const isDev = (): boolean =>
  typeof process !== 'undefined' &&
  (process.env.NODE_ENV !== 'production' || process.env.PYLON_DEV === '1')

let rootLogger: Logger = makeLogger({
  sink: isDev() ? lineSink : jsonSink,
  level: envLevel(),
  minRank: RANK[envLevel()],
  bindings: {}
})

/** The process-wide root logger (used outside any request/job scope). */
export const getRootLogger = (): Logger => rootLogger

/** @internal Phase 2 replaces the root from `config.logger`. Not part of the public API. */
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
    get level() {
      return resolve().level
    }
  }
}

// ── access-line toggle (config.logger: false) ──────────────────────────────────

let accessLog = true
/** Enable/disable the per-request access line (wired from `config.logger` at boot). */
export const setAccessLog = (on: boolean): void => {
  accessLog = on
}
export const accessLogEnabled = (): boolean => accessLog
