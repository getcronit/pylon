---
'@getcronit/pylon': minor
---

Structured runtime logger (phase 1).

A tiny, zero-dependency, runtime-agnostic structured logger now backs request logging. It
replaces the `hono/logger` text access line and exposes a request-correlated logger to your code.

- `getLogger()` — the current request logger (correlated by a generated `requestId`, tagged
  `http`, plus `method`/`path`). `logger(tag)` — a module-scoped, lazy, tagged logger.
- One structured access line per request: `{time, level, msg:"request", requestId, method, path,
  status, durationMs, tag:"http"}`.
- Levels (`trace`…`fatal`) gate cheaply, including **per-tag** levels: `LOG_LEVEL=info,db=debug`
  or `config.logger.level = {'*': 'info', db: 'debug'}` raises one subsystem without flooding the
  rest (most-specific tag prefix wins). Tags compose (`withTag`).
- `config.logger` accepts an object — `{level, format, base, redact, sink}` — as well as `false`
  (disable the access line). Env `LOG_LEVEL` / `PYLON_LOG_FORMAT` override without a redeploy.
  `redact` masks dotted paths (e.g. `authorization`, `user.password`); `base` adds fields to every
  record; `sink` swaps the destination (pino/OTel/…).

### Note: access-log format changed

The per-request access line is now **structured** — JSON in production, a terse single line in
development — instead of the previous `hono/logger` text. If you parse the old format, update your
log tooling.

Runtime-agnostic (no Node-only deps beyond `async_hooks`, already used for request context) and no
new dependency; the CLI/build logger (consola) is unaffected.
