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
- Levels (`trace`…`fatal`) gate cheaply; `LOG_LEVEL` sets the level.
- `config.logger: false` still disables the access line (the request logger keeps working).

### Note: access-log format changed

The per-request access line is now **structured** — JSON in production, a terse single line in
development — instead of the previous `hono/logger` text. If you parse the old format, update your
log tooling.

Runtime-agnostic (no Node-only deps beyond `async_hooks`, already used for request context) and no
new dependency; the CLI/build logger (consola) is unaffected.
