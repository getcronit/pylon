/**
 * `useQueues()` — runtime wiring for the queues, structurally a Pylon plugin (no
 * hard `@getcronit/pylon` dependency). It:
 *  - sets the Redis connection,
 *  - binds the ORM so jobs can use `Model.objects` (each job runs inside the
 *    ambient DB connection),
 *  - wires the transactional outbox (when pylon-db is present),
 *  - starts the workers + relay IN THIS PROCESS when told to: `worker: 'in-process'`
 *    (dev), or automatically when the process runs as a worker (`PYLON_ROLE=worker` —
 *    set by `.pylon/worker.mjs` and `pylon dev --worker`). The web process leaves this
 *    off and only enqueues.
 *  - optionally mounts a global Bull dashboard (all registered queues), gated by
 *    an injected `authorize` (so pylon-queues stays auth-agnostic).
 */
import type {RedisOptions} from 'ioredis'
import {setConnection} from './connection.js'
import {createPgOutbox} from './pg-outbox.js'
import {getOutboxDriver, runOutboxRelay, setOutboxDriver} from './outbox.js'
import {registeredQueues, setJobRunner, startWorkers} from './queue.js'
import {currentRole, getRootLogger} from '@getcronit/pylon'

export interface QueueDashboardOptions {
  /** Mount path. Default `/admin/queues`. */
  path?: string
  /**
   * Access gate — return true to allow. pylon-queues stays auth-agnostic; YOU
   * inject the check (e.g. `() => hasRole(getPrincipal(), 'SUPER_ADMIN')`).
   * Receives the request context.
   */
  authorize: (c: any) => boolean | Promise<boolean>
  /**
   * Runtime-specific static-asset server for the board UI — injected because it
   * differs per runtime: `serveStatic` from `@hono/node-server/serve-static`
   * (Node), `hono/bun`, `hono/cloudflare-workers`, … `@bull-board/api` +
   * `@bull-board/hono` are optional peer deps, lazy-loaded from your app.
   */
  serveStatic: unknown
}

export interface UseQueuesOptions {
  /** Redis connection (URL or options). Defaults to `REDIS_URL`. */
  connection?: string | RedisOptions
  /** Wire the Postgres transactional outbox (needs pylon-db). Default: true. */
  outbox?: boolean
  /**
   * Start workers + the outbox relay in THIS process. Use `'in-process'` for dev.
   * Leave it off for production: the worker entry (`node .pylon/worker.mjs`, or
   * `pylon dev --worker`) boots this same config with `PYLON_ROLE=worker`, which starts
   * the workers regardless of this option — so the web process (no `PYLON_ROLE`) only
   * enqueues while the worker process consumes.
   */
  worker?: 'in-process' | false
  /**
   * Mount a global Bull dashboard for every registered queue. Default: off (the
   * board exposes payloads + can retry/delete jobs — never expose implicitly).
   */
  dashboard?: false | QueueDashboardOptions
}

export interface QueuesPlugin {
  name: 'queues'
  strategy: 'last'
  setup(app?: unknown): Promise<void>
}

export function useQueues(options: UseQueuesOptions = {}): QueuesPlugin {
  return {
    name: 'queues',
    strategy: 'last',
    async setup(app?: unknown) {
      if (options.connection) setConnection(options.connection)

      // Optional ORM integration: bind the DB per job + wire the outbox.
      //
      // Guard on `hasDatabase()`, NOT just on pylon-db being importable. In the
      // monorepo (and any app with pylon-db installed) the import always
      // succeeds, but that says nothing about whether a database is CONNECTED.
      // `useDatabase()` is a 'first'-strategy plugin (it calls `connect()` in
      // setup) and `useQueues()` is 'last', so by the time this runs a DB is
      // connected IFF the app configured one. Binding `getDatabase().run` when
      // none is connected would make every job's runner throw "No active
      // database" — so a queues-only app (no `useDatabase()`) must keep the
      // default passthrough runner and skip the outbox.
      try {
        const {getDatabase, hasDatabase} = (await import(
          '@getcronit/pylon/db'
        )) as {
          getDatabase: () => {run: <T>(fn: () => T) => T}
          hasDatabase: () => boolean
        }
        if (hasDatabase()) {
          // Run each job inside the ambient DB connection → Model.objects works.
          setJobRunner((_job, fn) => getDatabase().run(fn))
          if (options.outbox !== false) setOutboxDriver(await createPgOutbox())
        } else if (options.outbox === true) {
          // Outbox was EXPLICITLY requested but there is no database to back it.
          // (Default is `undefined`/true — don't warn on the implicit default;
          // only when the user opted in and there's nothing to persist to.)
          getRootLogger()
            .withTag('queues')
            .warn(
              'outbox: true was set but no database is connected (no useDatabase()) — the transactional outbox is disabled.'
            )
        }
      } catch {
        /* pylon-db not installed → queues still work, without ORM/outbox. */
      }

      // Start consuming when explicitly asked (`worker: 'in-process'`) OR when the process
      // run-role consumes (`worker`, or `all` for a single process that also serves). This is
      // what lets ONE config drive both roles: the web process only enqueues; the worker (or
      // an `all` process) boots the same config and consumes. `useQueues` itself stays
      // role-untagged (it must wire the ORM/outbox in EVERY role so enqueue-in-txn works) —
      // only its consuming BEHAVIOR is role-gated here.
      const role = currentRole()
      if (options.worker === 'in-process' || role === 'worker' || role === 'all') {
        await startWorkers()
        // Only run the relay when the outbox is actually wired (a driver was set above);
        // otherwise there is nothing to drain and the poll loop would spin uselessly.
        if (getOutboxDriver()) runOutboxRelay()
      }

      if (options.dashboard && app) await mountDashboard(app, options.dashboard)
    }
  }
}

// Non-literal specifier → tsc treats it as `any` (no module resolution) and
// esbuild keeps it a runtime dynamic import, so the optional `@bull-board/*`
// peers are only required when the dashboard is actually enabled.
const dynImport = (m: string): Promise<any> => import(/* @vite-ignore */ m)

/**
 * Mount bull-board on the Pylon/Hono app behind the injected `authorize` gate.
 * Queues are auto-discovered from the global registry, so every queue across
 * every app shows up — no manual list. Runs in the web process (HTTP).
 */
async function mountDashboard(app: any, opts: QueueDashboardOptions): Promise<void> {
  if (typeof app?.route !== 'function' || typeof app?.use !== 'function') return
  const path = opts.path ?? '/admin/queues'

  let createBullBoard: any, BullMQAdapter: any, HonoAdapter: any
  try {
    ;({createBullBoard} = await dynImport('@bull-board/api'))
    ;({BullMQAdapter} = await dynImport('@bull-board/api/bullMQAdapter'))
    ;({HonoAdapter} = await dynImport('@bull-board/hono'))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[pylon-queues] dashboard not mounted — install @bull-board/api + @bull-board/hono:',
      err
    )
    return
  }

  const serverAdapter = new HonoAdapter(opts.serveStatic)
  serverAdapter.setBasePath(path)
  createBullBoard({
    queues: registeredQueues().map(q => new BullMQAdapter(q.bull)),
    serverAdapter
  })

  // Gate the index AND every sub-path of the board.
  const guard = async (c: any, next: () => Promise<void>) => {
    if (!(await opts.authorize(c))) return c.text('Forbidden', 403)
    await next()
  }
  app.use(`${path}/*`, guard)
  app.use(path, guard)
  app.route(path, serverAdapter.registerPlugin())
}
