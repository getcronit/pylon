---
'@getcronit/pylon': minor
---

Background workers now run the app itself — no `src/worker.ts`, no `pylon worker` command.

Previously the worker required a hand-written entry that imported the app and called
`startWorkers()` / `runOutboxRelay()`. Now the worker is the **same app in a different
run-role**, selected by `PYLON_ROLE` (`web` \| `worker` \| `all`):

- **Production:** `pylon build` emits `.pylon/worker.mjs` next to `.pylon/server.mjs` from the
  same build. Run `node .pylon/server.mjs` (web) and `node .pylon/worker.mjs` (worker) as
  separate processes. `--standalone` traces both entries and emits matching root launchers,
  `.pylon/standalone/start.mjs` (web) and `.pylon/standalone/start-worker.mjs` (worker).
- **Dev:** `pylon dev --worker` runs the worker from source with watch/restart — the dev twin
  of `node .pylon/worker.mjs`. The `pylon worker` command is removed.
- **Single process:** `PYLON_ROLE=all node .pylon/server.mjs` serves *and* consumes.

**Run-role plugin gate.** Plugins gain an optional `roles?: ('web' | 'worker')[]`.
`executeConfig` skips a plugin whose `roles` excludes the current role, so a worker never
runs — nor imports the deps of — the web-only plugins: `usePages` and `useNodeServer` are
tagged `['web']`, keeping React/react-router/manifests and the HTTP listener out of the
worker process and its standalone trace. Plugins that must run everywhere but behave by role
(`useQueues`: wire the ORM/outbox always, consume only in `worker`/`all`) stay untagged and
read the role themselves. Custom and infra plugins default to running in every role.

**Migration:** delete `src/worker.ts`. Replace a `node .pylon/src/worker.js` deploy with
`node .pylon/worker.mjs`, and a `pylon worker` dev command with `pylon dev --worker`. The
`worker: 'in-process'` option on `useQueues` still works (single-process dev consume), but is
now redundant with `pylon dev --worker`.
