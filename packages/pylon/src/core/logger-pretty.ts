/**
 * Rich pretty formatter for the runtime logger (rfcs/RUNTIME_LOGGER.md — Phase 5).
 *
 * DEV-ONLY and loaded LAZILY (via a variable specifier in logger.ts) so production, which emits
 * JSON, never evaluates it — no color/formatting overhead on the hot path, and it stays a small,
 * zero-dependency module. Type-only import of `LogRecord` (erased) → no runtime coupling to the
 * logger, no import cycle.
 *
 * Colors are ANSI escapes (no deps) and only applied to a TTY (and never when `NO_COLOR` is set),
 * so piped/aggregated output stays plain.
 */
import type {LogRecord} from './logger'

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
}

const LEVEL_COLOR: Record<string, string> = {
  trace: C.gray,
  debug: C.gray,
  info: C.green,
  warn: C.yellow,
  error: C.red,
  fatal: C.magenta
}
const LEVEL_LABEL: Record<string, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
  fatal: 'FATAL'
}

const colorOn = (): boolean =>
  typeof process !== 'undefined' &&
  Boolean((process.stdout as {isTTY?: boolean} | undefined)?.isTTY) &&
  !process.env.NO_COLOR

const paint = (code: string, s: string): string => (colorOn() ? `${code}${s}${C.reset}` : s)

const RESERVED = new Set(['time', 'level', 'msg', 'tag', 'err'])

const renderFields = (record: LogRecord): string => {
  const parts: string[] = []
  for (const key of Object.keys(record)) {
    if (RESERVED.has(key)) continue
    const value = record[key]
    const rendered = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
    parts.push(`${paint(C.dim, key + '=')}${rendered}`)
  }
  return parts.length ? '  ' + parts.join(' ') : ''
}

export const prettySink = (record: LogRecord): void => {
  const time = new Date(record.time).toISOString().slice(11, 23) // HH:MM:SS.mmm
  const level = paint(LEVEL_COLOR[record.level] ?? '', LEVEL_LABEL[record.level] ?? record.level.toUpperCase())
  const tag = record.tag ? paint(C.cyan, `[${record.tag}] `) : ''
  console.log(`${paint(C.dim, time)} ${level} ${tag}${record.msg}${renderFields(record)}`)

  // Normalized errors carry a `stack` — print it dimmed, on its own lines, for readability.
  const err = record.err as {stack?: unknown; message?: unknown} | undefined
  if (err && typeof err === 'object' && typeof err.stack === 'string') {
    console.log(paint(C.dim, err.stack))
  } else if (err && typeof err === 'object' && err.message) {
    console.log(paint(C.dim, String(err.message)))
  }
}

// CSS (not ANSI) because Chrome DevTools understands `%c`; Node ignores `%c` in a plain terminal.
const LEVEL_CSS: Record<string, string> = {
  trace: 'color:gray',
  debug: 'color:gray',
  info: 'color:green',
  warn: 'color:orange',
  error: 'color:red;font-weight:bold',
  fatal: 'color:magenta;font-weight:bold'
}

/**
 * DevTools sink: a CSS-colored headline PLUS the full record as an extra arg — Chrome renders that
 * object as an expandable, inspectable tree (drill into `err.stack`, nested fields, …), while the
 * headline stays readable. So you get BOTH the pretty line and the clickable object. In a plain
 * terminal `%c` is stripped and the record is printed inline (util.inspect), so it degrades gracefully.
 */
export const devtoolsSink = (record: LogRecord): void => {
  const label = LEVEL_LABEL[record.level] ?? record.level.toUpperCase()
  const tag = record.tag ? `[${record.tag}] ` : ''
  console.log(`%c${label}%c ${tag}${record.msg}`, LEVEL_CSS[record.level] ?? '', '', record)
}
