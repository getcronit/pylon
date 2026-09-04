/**
 * Internal worker bootstrap — the dev target of `pylon dev --worker` (production uses the
 * generated `.pylon/worker.mjs` instead). There is NO `src/worker.ts` to author.
 *
 * `pylon dev --worker` runs THIS file through the loader and hands it two absolute paths via env:
 *
 *   __PYLON_WORKER_APP__     the app entry (default `src/index.ts`) — importing it constructs
 *                            your `Pylon` and REGISTERS its queue classes (constructor hook).
 *   __PYLON_WORKER_CONFIG__  the `pylon.config.*` (may be empty) — its plugins are what wire
 *                            the DB connection (`useDatabase`), the ORM-per-job binding + the
 *                            transactional outbox, and start the consumers (`useQueues`).
 *
 * The boot is IDENTICAL to the server's (see emit-server-glue.ts) except: (1) it sets
 * `PYLON_ROLE=worker` FIRST, so `useNodeServer` no-ops (no port bound) and `useQueues` starts
 * consuming; (2) it never mounts the GraphQL handler — a worker has no HTTP surface. Running
 * the real config is the point: the worker shares the app's exact DB/identity/outbox wiring
 * rather than reconstructing a partial copy.
 */
import {executeConfig} from '@getcronit/pylon'

// Mark the role BEFORE any plugin setup runs — `useNodeServer`/`useQueues` read it at setup.
process.env.PYLON_ROLE = 'worker'

const appEntry = process.env.__PYLON_WORKER_APP__
if (!appEntry) {
  console.error('[pylon worker] missing __PYLON_WORKER_APP__ — nothing to boot')
  process.exit(1)
}

const configEntry = process.env.__PYLON_WORKER_CONFIG__

// The app's default export is the composed `Pylon` instance (same contract the server uses).
const app = (await import(appEntry)).default

// Load the config the same way the server glue + dev boot do: default/`config` export,
// resolving a factory function. No config → an empty one (queues can still run off REDIS_URL).
const config = await (async () => {
  if (!configEntry) return {plugins: []}
  const mod = await import(configEntry)
  const raw = mod.default ?? mod.config ?? {}
  return typeof raw === 'function' ? await raw() : raw
})()

// Two-pass boot against THIS instance: 'first' plugins (identity/db) then 'last' plugins
// (useQueues is 'last' — it starts the consumers + outbox relay here because PYLON_ROLE=worker).
await executeConfig(config, undefined, app)
await executeConfig(config, {pluginsStrategy: 'last'}, app)

// Hold the event loop open. Running BullMQ workers + the outbox relay already do this, but a
// config with zero active consumers otherwise has no pending work — and a never-resolving
// top-level `await` would be flagged as an unsettled top-level await and exit (code 13). A
// ref'd interval is a real handle that keeps the process alive without that trap.
setInterval(() => {}, 1 << 30)
