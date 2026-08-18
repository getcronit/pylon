# Runtime Logger — Phase 1 Implementation Plan

Companion to [RUNTIME_LOGGER.md](./RUNTIME_LOGGER.md). Phase 1 only: the **core logger**, the
**HTTP request scope**, and the **structured access line** replacing `hono/logger`. Everything
else (per-tag levels, the config object, Sentry sink, queues, the rich pretty formatter) is a
later phase and explicitly out of scope here.

Ground truth verified against: `src/core/context.ts`, `src/core/index.ts`, `src/app/index.ts`
(`installBasePipeline`), `src/app/pylon-handler.ts`, `src/core/index.ts` (`PylonConfig`).

## Deliverable

After phase 1, a served Pylon app:
- emits one **structured JSON** access line per request (`{time, level, msg, requestId, method,
  path, status, durationMs, tag: 'http'}`), replacing the `hono/logger` text line;
- exposes `getLogger()` / `logger(tag)` from `@getcronit/pylon`, request-correlated in resolvers
  and plain routes;
- honors `logger: false` in `pylon.config` (skips the access line) — restoring the toggle that
  never merged into v3;
- pulls **no new dependency** and adds **nothing** Node-only beyond the `async_hooks` core already
  uses.

## 1. New file — `src/core/logger.ts` (zero-dep, runtime-agnostic)

```ts
import {AsyncLocalStorage} from 'async_hooks' // already used by core/context.ts

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type LogFields = Record<string, unknown>
export interface LogRecord {
  time: number
  level: LogLevel
  msg: string
  tag?: string
  [k: string]: unknown
}
export interface Logger {
  trace(msg: string, fields?: LogFields): void
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  fatal(msg: string, fields?: LogFields): void
  child(bindings: LogFields): Logger
  withTag(tag: string): Logger
  readonly level: LogLevel
}

const RANK: Record<LogLevel, number> = {trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60}
type Sink = (r: LogRecord) => void

// Default sink: one JSON line. `console` exists on every runtime; no deps.
const jsonSink: Sink = r => console.log(JSON.stringify(r))
// Minimal dev formatter — inline, no colors/deps (the RICH pretty printer is phase 5).
const lineSink: Sink = r =>
  console.log(`${r.level.toUpperCase().padEnd(5)} ${r.tag ? '[' + r.tag + '] ' : ''}${r.msg}` +
    fieldsTail(r))

interface LoggerState {
  sink: Sink
  minRank: number
  level: LogLevel
  tag?: string
  bindings: LogFields
}

function make(s: LoggerState): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (RANK[level] < s.minRank) return // cheap gate before building the record
    const rec: LogRecord = {time: Date.now(), level, msg, ...s.bindings, ...fields}
    if (s.tag) rec.tag = s.tag
    s.sink(rec)
  }
  return {
    trace: (m, f) => emit('trace', m, f),
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    fatal: (m, f) => emit('fatal', m, f),
    child: b => make({...s, bindings: {...s.bindings, ...b}}),
    withTag: t => make({...s, tag: s.tag ? `${s.tag}:${t}` : t}),
    get level() { return s.level }
  }
}

// ── root logger ────────────────────────────────────────────────────────────
const envLevel = (): LogLevel => {
  const v = (typeof process !== 'undefined' && process.env.LOG_LEVEL)?.toLowerCase()
  return (v && v in RANK ? v : 'info') as LogLevel
}
const isDev = () =>
  typeof process !== 'undefined' &&
  (process.env.NODE_ENV !== 'production' || process.env.PYLON_DEV === '1')

let rootLogger: Logger = make({
  sink: isDev() ? lineSink : jsonSink,
  level: envLevel(),
  minRank: RANK[envLevel()],
  bindings: {}
})
export const getRootLogger = () => rootLogger

// Phase-2 hook: config.logger = {level, sink, format} replaces the root. Kept internal now.
export const __setRootLogger = (l: Logger) => { rootLogger = l }

// ── request/job scope (its OWN ALS — HTTP, jobs, and the outbox relay all bind here) ──
const loggerContext = new AsyncLocalStorage<Logger>()
export const getLogger = (): Logger => loggerContext.getStore() ?? rootLogger
export const runWithLogger = <T>(log: Logger, fn: () => T): T => loggerContext.run(log, fn)

// Module-scope, lazy, tagged — resolves the current logger per call (stays correlated).
export const logger = (tag: string): Logger => make0(() => getLogger().withTag(tag))
// tiny lazy facade so `const log = logger('x')` at module top is safe:
function make0(resolve: () => Logger): Logger {
  const call = (m: keyof Logger) => (...a: any[]) => (resolve() as any)[m](...a)
  return {
    trace: call('trace'), debug: call('debug'), info: call('info'),
    warn: call('warn'), error: call('error'), fatal: call('fatal'),
    child: b => resolve().child(b),
    withTag: t => resolve().withTag(t),
    get level() { return resolve().level }
  } as Logger
}

// ── access-line toggle (config.logger: false) ────────────────────────────────
let accessLog = true
export const setAccessLog = (on: boolean) => { accessLog = on }
export const accessLogEnabled = () => accessLog

function fieldsTail(r: LogRecord): string { /* dev-only: append k=v for extra fields */ }
```

Notes:
- **Level gate is a number compare** before allocating the record — `trace`/`debug` are ~free at
  `info`.
- Phase 1 ships a **single scalar level** from `LOG_LEVEL` (default `info`). The per-tag map is
  phase 2 — `make()` already carries a `tag`, so phase 2 only changes how `minRank` is chosen.
- `format` is not a config option yet; the root picks `lineSink` in dev / `jsonSink` in prod so
  `pylon dev` doesn't regress to raw JSON. The rich formatter (colors, lazy module) is phase 5.

## 2. Exports — `src/core/index.ts`

Next to the existing `export {asyncContext, getContext, setContext} from './context.js'`:

```ts
export {getLogger, logger, runWithLogger, getRootLogger} from './logger.js'
export type {Logger, LogLevel, LogFields, LogRecord} from './logger.js'
```

These already re-export through `@getcronit/pylon` (core is the package root). Confirm the pages
entry / other subpaths don't need them (they can import from the root).

## 3. HTTP middleware — `src/app/index.ts` `installBasePipeline`

Replace **only** the third step (the `hono/logger` line). Order and the surrounding
`asyncContext.run` bind are unchanged:

```ts
// remove:  import {logger} from 'hono/logger'
// remove:  this.use('*', except(['/__pylon/*'], logger()))
// add:
this.use('*', except(['/__pylon/*'], async (c, next) => {
  const requestId =
    c.req.header('x-request-id') ?? c.req.header('traceparent')?.split('-')[1] ?? newId()
  const reqLog = getRootLogger()
    .child({requestId, method: c.req.method, path: c.req.path})
    .withTag('http')
  const start = Date.now()
  await runWithLogger(reqLog, next)          // nested inside the existing asyncContext.run
  if (accessLogEnabled())
    reqLog.info('request', {status: c.res.status, durationMs: Date.now() - start})
}))
```

- Keeps the `except(['/__pylon/*'])` skip so static-asset requests stay quiet.
- `newId()` = `globalThis.crypto?.randomUUID?.() ?? fallback` — runtime-agnostic (Web Crypto on
  workerd/Bun/Deno, Node 19+); a small counter/time fallback for older Node.
- `runWithLogger` wraps `next()`, so every downstream plugin/resolver/route sees the correlated
  logger via `getLogger()`.

## 4. Config back-compat — `config.logger: false`

The toggle isn't honored in this branch, so add it:

- `src/core/index.ts` `PylonConfig`: add `logger?: boolean` (phase 2 widens to the object form).
- Wire it where config is applied at boot: when `config.logger === false`, call
  `setAccessLog(false)`. The most likely site is the config-apply path in `executeConfig` /
  `pylon-handler.ts` (siblings `graphiql`/`landingPage` are read there) — **confirm the exact seam
  during implementation** and set the flag once at boot, not per request.

## 5. Tests

Unit — `test/core/logger.test.ts` (fast, sink-captured, no server):
- level gate: `debug` suppressed at `info`, emitted after raising `LOG_LEVEL`;
- `child` merges bindings; `withTag` composes (`a` → `a:b`); record shape (`time/level/msg/tag`);
- `getLogger()` returns root outside a scope, the bound logger inside `runWithLogger`;
- `logger('x')` is lazy — declared before a `runWithLogger`, it still picks up the scope at call.

Integration — `test/app/logger-pipeline.test.ts` (in-process `app.fetch`, no network):
- a request emits one access record with `requestId/method/path/status/durationMs/tag:'http'`
  (capture via a test sink / `__setRootLogger`);
- `getLogger()` inside a route is correlated to the same `requestId`;
- `/__pylon/*` requests emit **no** access line;
- `logger: false` → no access line, but `getLogger()` still works.

## 6. Validation

- `pnpm --filter @getcronit/pylon typecheck && … build`
- `npx vitest run test/core/logger.test.ts test/app` — new + existing green (the CLI/build logger
  is untouched; this is runtime only).
- Smoke: `pylon dev` on docs → dev line format, one access line per request; a built serve → JSON
  lines. Confirm **no consola import** reaches `src/core/logger.ts` (runtime-agnostic + keeps the
  standalone trace lean).
- `--standalone` trace unaffected (logger is core, already traced; no new deps).

## 7. Risks / behavior changes

- **Format change**: the access line goes text → structured (JSON in prod, a terse dev line).
  Anyone parsing the old hono text line is affected — call it out in the changeset.
- **`config.logger`** now means "access line on/off" (phase 2 makes it an object); `false` stays
  back-compatible.
- **workerd**: `async_hooks` needs `nodejs_compat` (already required for Workers). Without it,
  `getLogger()` falls back to the root logger — degrade, don't throw.

## 8. Out of scope (later phases)

Per-tag levels + the `logger` config object + `LOG_LEVEL=info,db=debug` (2) · Sentry `sentrySink`
+ error-path logging (3) · queue job scope + `job.log` fan-out (4) · rich pretty formatter (5).

## 9. Checklist

- [ ] `src/core/logger.ts` (types, `make`, root, ALS, `getLogger`/`runWithLogger`/`logger`, sinks, toggle)
- [ ] Export from `src/core/index.ts`
- [ ] Swap the `hono/logger` middleware in `installBasePipeline`; drop the `hono/logger` import
- [ ] `PylonConfig.logger?: boolean` + wire `setAccessLog(false)` at boot
- [ ] `newId()` runtime-agnostic helper
- [ ] `test/core/logger.test.ts` + `test/app/logger-pipeline.test.ts`
- [ ] typecheck · build · vitest · dev+serve smoke · confirm no consola in core
- [ ] changeset noting the access-line format change
