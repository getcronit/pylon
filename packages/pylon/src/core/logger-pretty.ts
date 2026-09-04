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

/** Build the human line(s) for a record: the headline, then any error stack/message on its own line. */
const prettyLines = (record: LogRecord): string[] => {
  const time = new Date(record.time).toISOString().slice(11, 23) // HH:MM:SS.mmm
  const level = paint(LEVEL_COLOR[record.level] ?? '', LEVEL_LABEL[record.level] ?? record.level.toUpperCase())
  const tag = record.tag ? paint(C.cyan, `[${record.tag}] `) : ''
  const lines = [`${paint(C.dim, time)} ${level} ${tag}${record.msg}${renderFields(record)}`]

  // Normalized errors carry a `stack` — print it dimmed, on its own lines, for readability.
  const err = record.err as {stack?: unknown; message?: unknown} | undefined
  if (err && typeof err === 'object' && typeof err.stack === 'string') {
    lines.push(paint(C.dim, err.stack))
  } else if (err && typeof err === 'object' && err.message) {
    lines.push(paint(C.dim, String(err.message)))
  }
  return lines
}

export const prettySink = (record: LogRecord): void => {
  for (const line of prettyLines(record)) console.log(line)
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
 * DevTools sink: two non-overlapping channels so you get the best of both surfaces.
 *
 *  - Terminal — the clean pretty line, written via `process.stdout.write` (NOT `console.log`).
 *    A `console.*` call is mirrored into an attached DevTools console, which would duplicate the
 *    headline next to the object below; raw stdout is not forwarded to DevTools, so the terminal
 *    stays a single readable line.
 *  - DevTools — the raw record as a CSS-headlined, expandable/inspectable tree, sent through
 *    `inspector.console` (the dev server exposes it on `globalThis` when a debugger is attached).
 *    `inspector.console` bypasses stdout, so this never clutters the terminal.
 *
 * With no inspector console available (devtools format without an attached debugger) it's just the
 * pretty terminal line — a graceful fallback.
 */
export const devtoolsSink = (record: LogRecord): void => {
  for (const line of prettyLines(record)) process.stdout.write(line + '\n')

  const ic = (globalThis as {__PYLON_INSPECTOR_CONSOLE__?: {log(...a: unknown[]): void}})
    .__PYLON_INSPECTOR_CONSOLE__
  if (ic) {
    const label = LEVEL_LABEL[record.level] ?? record.level.toUpperCase()
    const tag = record.tag ? `[${record.tag}] ` : ''
    ic.log(`%c${label}%c ${tag}${record.msg}`, LEVEL_CSS[record.level] ?? '', '', record)
  }
}
