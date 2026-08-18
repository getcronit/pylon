# RFC: Runtime Logger (Tier 2)

Status: **Draft / sketch**. Scope: the **runtime/serve** logger — distinct from the CLI/build
logger (consola), which is done. See the "Two tiers" note at the end for why they stay separate.

## Motivation

Today the runtime logs requests via `hono/logger` (a human-formatted access line), toggled by
`config.logger: false`. That's all. Gaps for production:

- **No levels.** It's on or off — no `debug`/`info`/`warn`/`error`.
- **No structure.** A text line, not JSON — can't be queried by a log aggregator.
- **Not request-scoped beyond the access line.** A resolver that wants to log has no
  request-correlated logger (no requestId, principal, tenant).
- **No coverage of resolvers, queues, or SSR.** Only the HTTP access line is logged.
- **No integration story.** Errors, Sentry (`useSentry`/Toucan), and app logs are unrelated.

## Goals

1. **Leveled** — `trace · debug · info · warn · error · fatal`, gated cheaply.
2. **Structured** — JSON records in production; pretty in dev (`format: 'auto'`).
3. **Request-scoped** — auto-binds `requestId`, `method`, `path`; plugins enrich (principal,
   tenant). Reuses the existing `asyncContext` (AsyncLocalStorage) — no new plumbing.
4. **Broad** — one logger for HTTP requests, GraphQL resolvers, queue jobs, and pages SSR.
5. **Configurable** — level, format, redaction, sink, base fields; env overrides.
6. **Runtime-agnostic** — Node · Bun · Deno · workerd. No Node-only APIs beyond `async_hooks`,
   which core already uses for context.
7. **Zero runtime bloat** — ~100 LOC, no deps, `console`-based default sink. **No consola in the
   serve graph** (it would bloat the runtime *and* the standalone trace — see the Tier-2 trap).
8. **Pluggable + observability-ready** — a `sink(record)` seam for pino/OTel/file; the existing
   Sentry plugin bridges errors without core depending on it.

## Non-goals

- Not a log **transport/aggregator**. Emit JSON to stdout; let the platform collect it. No file
  rotation, no network sinks in core (those are `sink` implementations users opt into).
- Not a **Sentry replacement**. Errors still go to Sentry; the logger emits structured events and
  the error path feeds both.

## Design

### 1. The `Logger` interface (tiny, zero-dep, runtime-agnostic)

```ts
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type LogFields = Record<string, unknown>

export interface Logger {
  trace(msg: string, fields?: LogFields): void
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  fatal(msg: string, fields?: LogFields): void
  /** A logger that always includes `bindings` (e.g. `{requestId}`) on every record. */
  child(bindings: LogFields): Logger
  /** Effective minimum level; below it, calls are a cheap no-op. */
  readonly level: LogLevel
}
```

The record it emits (before the sink):

```jsonc
{
  "time": 1699999999999,        // epoch ms (Date is available on every runtime)
  "level": "info",
  "msg": "request completed",
  "requestId": "01HF…",         // request child bindings
  "method": "POST", "path": "/graphql", "status": 200, "durationMs": 12,
  "principal": "user_42",       // added by useIdentity (core is auth-free)
  "tenant": "acme",             // added by useDatabase tenancy
  // …any per-call fields
}
```

### 2. The default sink (universal, no bloat)

```ts
// Works on Node/Bun/Deno/workerd; no deps; one line per record.
const jsonSink = (r: LogRecord) => console.log(JSON.stringify(r))
```

Pretty dev output is a **separate, lazily-loaded** formatter, imported through a variable
specifier so nft/bundlers never pull it into the prod/edge graph (the same trick that keeps the
build pipeline out of the standalone trace):

```ts
if (format === 'pretty') {
  const mod = './pretty' // non-literal → not traced
  sink = (await import(mod)).prettySink
}
```

### 3. Request scoping — reuse `asyncContext`

Core already binds the Hono context per request via `AsyncLocalStorage` (`core/context.ts`), and
`Variables` already carries a request-scoped `sentry: Toucan` — so a request `logger` is the same
pattern:

- In `installBasePipeline`, **replace** `hono/logger` with a middleware that:
  1. builds `reqLog = rootLogger.child({ requestId, method, path })`,
  2. stashes it on the context (`c.set('logger', reqLog)` — add `logger: Logger` to `Variables`),
  3. after `next()`, emits `reqLog.info('request', { status, durationMs })` — the structured
     access line (honoring `config.logger: false` to skip it).
- `getLogger()` reads `asyncContext` → the request logger; outside a request it returns the root
  logger. So resolvers/user code just call `getLogger().info(...)` and get correlation for free.

```ts
export const getLogger = (): Logger =>
  asyncContext.getStore()?.get('logger') ?? rootLogger
```

Enrichment stays plugin-owned (core is auth-free): `useIdentity` does
`c.set('logger', getLogger().child({ principal: p.id }))` once auth resolves; `useDatabase` adds
`{ tenant }`. Core only knows `requestId/method/path`.

### 4. Config + levels

Extend the existing toggle without breaking it:

```ts
// PylonConfig
logger?:
  | boolean                     // false = off (today's behavior); true/absent = defaults
  | {
      level?: LogLevel          // default: env LOG_LEVEL, else 'info'
      format?: 'json' | 'pretty' | 'auto'   // 'auto' = pretty in dev, json in prod
      base?: LogFields          // fields on every record (service, version, region…)
      redact?: string[]         // dotted paths to mask (authorization, password…)
      sink?: (record: LogRecord) => void     // override the destination (pino/OTel/…)
    }
```

- Env overrides: `LOG_LEVEL`, `PYLON_LOG_FORMAT` — so ops can raise verbosity without a redeploy.
- Level gate is a single integer compare before building the record → `trace`/`debug` in a hot
  path cost ~nothing when the level is `info`.

### 5. Integration surface

- **Resolvers / user code**: `import { getLogger } from '@getcronit/pylon'` → request-correlated.
- **Errors → Sentry**: the error-mapping layer (Yoga `onExecuteDone` / `Pylon.onError`) logs at
  `error`/`fatal` with the mapped code + stack, then the **existing** `useSentry` plugin captures
  via the request `Toucan`. One structured event **and** a Sentry capture; the logger never
  hard-depends on Sentry. (Optionally a `sentrySink` users can compose.)
- **Queues / worker**: the worker has no HTTP request, so wrap each job in an `asyncContext` scope
  with `rootLogger.child({ queue, jobId, attempt })`. `getLogger()` then works inside processors,
  same API.
- **Pages SSR**: SSR runs inside the request pipeline, so `getLogger()` is already correlated in
  loaders/`useData`.

### 6. Where it lives

**Core, not a plugin.** Logging is fundamental (the access line is already in `installBasePipeline`)
and `getLogger()` must work everywhere unconditionally. What's user-controlled — level, format,
redaction, sink — is `config.logger`, and *enrichment* is plugin-contributed. A `useLogger()`
plugin is unnecessary; the seam is the config + the `sink`.

## Back-compat & rollout

`config.logger: false` keeps working (skips the access line). Phased:

1. **Core**: `Logger`, `rootLogger`, `getLogger`, request child + structured access line
   (replaces `hono/logger`). `Variables.logger`.
2. **Config**: the object form (level/format/base/redact/sink) + env overrides; `'auto'` format.
3. **Errors/Sentry**: error path logs structured + keeps the Toucan capture.
4. **Queues**: per-job ALS scope + child logger.
5. **Pretty formatter**: lazy dev module (kept out of the prod trace).

Each phase ships independently; phase 1 alone already replaces the text access log with queryable
JSON and gives resolvers a correlated logger.

## Open questions

- **workerd + ALS**: `async_hooks` needs `nodejs_compat` (the runtimes doc already requires it for
  Workers). Without it, degrade `getLogger()` to the root logger (no per-request correlation).
- **Trace correlation**: bind `traceId`/`spanId` from an incoming `traceparent` when present, for
  OTel correlation.
- **Sampling**: high-volume `debug` sampling (e.g. 1%) — a `sink` concern or a core option?
- **Redaction depth**: shallow dotted-path masking in core; deep/custom redaction via `sink`.

## The two tiers, and why they stay separate

- **Tier 1 — CLI/build** (done): `consola` with levels; `-v/--verbose` sets `consola.level`.
  Pretty, human, dev-oriented.
- **Tier 2 — runtime** (this doc): a lightweight leveled/structured logger. **Must not import
  consola** — the serve path (and the `--standalone` trace) has to stay minimal, and consola is a
  CLI pretty-printer. They share the *concept* (a level enum) and nothing else.
