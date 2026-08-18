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

The logger must be correlated in **three** places — HTTP requests, queue jobs, and the outbox
relay — and only the first has a Hono context (jobs run in `pylon worker` with no request). So the
scope lives in its **own** `AsyncLocalStorage<Logger>`, not piggybacked on the Hono context:

```ts
// core/logger.ts
const loggerContext = new AsyncLocalStorage<Logger>()
export const getLogger = (): Logger => loggerContext.getStore() ?? rootLogger
/** Run `fn` with `log` as the active logger (used by the HTTP pipeline, the job runner, …). */
export const runWithLogger = <T>(log: Logger, fn: () => T): T => loggerContext.run(log, fn)
```

- **HTTP** — in `installBasePipeline`, **replace** `hono/logger` with a middleware that builds
  `reqLog = rootLogger.child({requestId, method, path}).withTag('http')`, runs the rest of the
  request via `runWithLogger(reqLog, next)`, and after it emits `reqLog.info('request', {status,
  durationMs})` — the structured access line (skipped when `config.logger: false`).
- Enrichment stays plugin-owned (core is auth-free): `useIdentity` re-binds
  `runWithLogger(getLogger().child({principal: p.id}), next)` once auth resolves; `useDatabase`
  adds `{tenant}`. Core only knows `requestId/method/path`.

(A dedicated ALS also keeps the logger from depending on Hono's `Context` type — jobs and the
relay don't have one — and avoids coupling core to the DB app-context that jobs actually run in.)

### 4. Config + levels

Extend the existing toggle without breaking it:

```ts
// PylonConfig
logger?:
  | boolean                     // false = off (today's behavior); true/absent = defaults
  | {
      level?: LogLevel | Record<string, LogLevel>  // scalar, or per-tag map (see §5)
      format?: 'json' | 'pretty' | 'auto'   // 'auto' = pretty in dev, json in prod
      base?: LogFields          // fields on every record (service, version, region…)
      redact?: string[]         // dotted paths to mask (authorization, password…)
      sink?: (record: LogRecord) => void     // override the destination (pino/OTel/…)
      job?: {level?: LogLevel}  // threshold for the BullMQ job.log() tee (default 'info',
    }                           //   separate from stdout — keeps the persisted per-job log lean)
```

- Env overrides: `LOG_LEVEL`, `PYLON_LOG_FORMAT` — so ops can raise verbosity without a redeploy.
- Level gate is a single integer compare before building the record → `trace`/`debug` in a hot
  path cost ~nothing when the level is `info`.

### 5. Tags & per-tag levels

A **tag** is a hierarchical *component* label (`db`, `queue:email`, `billing:stripe`) — distinct
from `fields` (arbitrary structured data). It answers "which part of the app emitted this," and
it's the axis you filter and **level** by. `withTag` composes:

```ts
const log = getLogger().withTag('billing')   // record.tag = "billing"
log.withTag('stripe').info('charge ok')       // record.tag = "billing:stripe"
```

Stored as one `tag` string on the record. Ad-hoc labels that aren't a component stay ordinary
fields — `log.warn('slow', { tags: ['n+1'] })`.

**Per-tag levels — the reason tags are first-class.** `level` accepts a map, and `LOG_LEVEL` a
comma list, so you can raise verbosity for ONE subsystem in production without flooding the rest:

```ts
logger: { level: { '*': 'info', db: 'debug', 'queue:email': 'trace' } }
// or, no redeploy:
LOG_LEVEL=info,db=debug,queue:email=trace
```

The gate resolves the **most-specific matching prefix** for a record's tag (`queue:email` beats
`queue` beats `*`), so `db.debug(...)` fires while everything else stays at `info`. The framework
tags its own output the same way — `http`, `graphql`, `db`, `queue`, `pages` — so these knobs work
on framework logs too, not just yours.

### 6. Integration surface

- **Resolvers / user code**: `import { getLogger } from '@getcronit/pylon'` → request-correlated.
- **Errors → Sentry**: the error-mapping layer (Yoga `onExecuteDone` / `Pylon.onError`) logs at
  `error`/`fatal` with the mapped code + stack, then the **existing** `useSentry` plugin captures
  via the request `Toucan`. One structured event **and** a Sentry capture; the logger never
  hard-depends on Sentry. (Optionally a `sentrySink` users can compose.)
- **Queues / worker** — the important one, because a BullMQ job already has a *second* log
  destination. Pylon's `JobContext` exposes `log(message)`, wired to `job.log(m)` — BullMQ's
  **persisted per-job log** (stored in Redis, shown in the queue dashboard), distinct from stdout.
  The design must serve both without splitting the API:

  - **Where the scope goes.** `useQueues` already wraps every job via the `setJobRunner` seam
    (`(_job, fn) => getDatabase().run(fn)` — binds the ORM connection/tenant). Compose the logger
    scope there: `setJobRunner((job, fn) => getDatabase().run(() => runWithLogger(jobLog(job), fn)))`.
  - **The job logger** is `rootLogger.child({queue, jobId, attempt}).withTag('queue:' + name)` with
    a **fan-out sink**: (a) the normal stdout sink (structured JSON, fleet-wide, honors per-tag
    levels), **and** (b) a `job.log(format(record))` sink → the dashboard sees the same events.
    So one `getLogger().info('sending', {to})` inside a processor lands in *both* places.
  - **Reconcile the existing `ctx.log`.** `JobContext.log(msg)` becomes sugar for
    `getLogger().info(msg)` — so it now also reaches stdout (a strict improvement), and old code
    keeps working. `ctx` still carries `data`/`job`; `getLogger()`/`logger('queue:'+name)` is the
    richer, leveled, tagged path.
  - **Keep Redis lean.** The `job.log()` sink has its **own** threshold (default `info`), separate
    from the stdout level — so cranking `queue:email=trace` on stdout for debugging doesn't flood
    the persisted per-job log. Configurable via `logger.job.level`.
  - **Outbox relay** (`runOutboxRelay`) has no BullMQ job, so it just runs under a
    `rootLogger.withTag('outbox')` scope — structured stdout only, no `job.log` tee.
- **Pages SSR**: SSR runs inside the request pipeline, so `getLogger()` is already correlated in
  loaders/`useData`.

### 7. Where it lives

**Core, not a plugin.** Logging is fundamental (the access line is already in `installBasePipeline`)
and `getLogger()` must work everywhere unconditionally. What's user-controlled — level, format,
redaction, sink — is `config.logger`, and *enrichment* is plugin-contributed. A `useLogger()`
plugin is unnecessary; the seam is the config + the `sink`.

## Using it from application code

Two entry points, both from `@getcronit/pylon`:

- **`getLogger()`** — the *current* request logger (or the root logger outside a request). Use it
  inline; it's already correlated with `requestId` and (once plugins run) `principal`/`tenant`.
- **`logger(tag)`** — a *module-scoped, lazy, tagged* logger. Assign it once at the top of a file;
  it re-resolves the current request logger on every call, so it stays correlated **and** carries
  the tag. This is the everyday ergonomic.

```ts
import {logger, getLogger} from '@getcronit/pylon'

// Module scope — stable, tagged, still per-request-correlated (resolves lazily per call):
const log = logger('billing')

export const graphql = {
  Mutation: {
    async charge(amount: number): Promise<Charge> {
      log.info('charge requested', {amount})          // tag=billing, + requestId/principal
      try {
        const c = await stripe.charge(amount)
        log.info('charge ok', {chargeId: c.id})
        return c
      } catch (err) {
        log.error('charge failed', {amount, err})     // structured event + Sentry capture
        throw err
      }
    }
  }
}

// Inline, with one-off bindings via child():
export async function ship(orderId: string) {
  const olog = getLogger().child({orderId})
  olog.debug('picking items')                          // emitted only when the level allows
  olog.info('shipped')
}
```

Inside a **queue processor** it's the same call — the job runner wraps each job in the logger
scope, so the logger is auto-correlated to `{queue, jobId, attempt}` **and tees to the job's
persisted log** (dashboard) as well as stdout:

```ts
emailQueue.process(async ({data, job, log}) => {
  // `log(msg)` is JobContext sugar → getLogger().info(msg): stdout + the job's dashboard log.
  const jlog = logger('queue:email')              // structured, leveled, same dual destination
  jlog.info('sending', {to: data.to})             // → stdout JSON  AND  job.log line
  jlog.debug('smtp handshake', {host})            // stdout only unless the job-log level allows
  await job.updateProgress(50)
})
```

The one rule: reach for `logger(tag)` / `getLogger()` **at call time** rather than capturing
`const log = getLogger()` at module top — a snapshot taken at import has no request context.
`logger(tag)` sidesteps the trap by resolving lazily on each call.

## Back-compat & rollout

`config.logger: false` keeps working (skips the access line). Phased:

1. **Core**: `Logger`, `rootLogger`, `getLogger`, `logger(tag)`, `child`/`withTag`, request child
   + structured access line (replaces `hono/logger`). `Variables.logger`.
2. **Config**: the object form (level/format/base/redact/sink) + **per-tag levels** + env
   overrides (`LOG_LEVEL=info,db=debug`); `'auto'` format.
3. **Errors/Sentry**: error path logs structured + keeps the Toucan capture.
4. **Queues**: job-runner logger scope (`{queue, jobId, attempt}`, tag `queue:<name>`) with the
   stdout + `job.log()` fan-out sink; `ctx.log` → `getLogger().info`; outbox relay tagged `outbox`.
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
