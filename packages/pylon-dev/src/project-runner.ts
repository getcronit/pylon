/**
 * The project runner — executed as a CHILD process (via tsx) with `cwd` set to the
 * user's project, so it loads the project's REAL modules in the project's own
 * context. This is the successor to the bundle-based `loadProjectApp`:
 *
 *   • It resolves `@getcronit/pylon-db` FROM THE PROJECT, so the ORM instance the
 *     models register into is the same one this runner reads — no re-export bundle
 *     needed (pnpm can't hand back a second copy when both resolve from one place).
 *   • It imports the entry as-is (no source stripping, no flattening), so
 *     `import.meta` / `__dirname` / stack traces all reflect the real files.
 *
 * Protocol: a single JSON envelope is written between sentinels on stdout (the
 * user's own logs stay on stdout/stderr around it); the parent extracts it. See
 * `spawnProjectRunner` in project-bridge.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {RESULT_OPEN, RESULT_CLOSE, type RunnerEnvelope} from './project-runner-protocol.js'
import {runDbCommandCore} from './db/index.js'
import type {ProjectApp} from './project-bridge.js'

/**
 * Write the result envelope to the file the parent named (`PYLON_RUNNER_RESULT_FILE`),
 * keeping stdout/stderr purely for logs. Falls back to a sentinel-framed block on
 * stdout when there's no parent file (the runner invoked standalone).
 */
function emit(payload: RunnerEnvelope): void {
  const json = JSON.stringify(payload)
  const file = process.env.PYLON_RUNNER_RESULT_FILE
  if (file) fs.writeFileSync(file, json)
  else process.stdout.write(RESULT_OPEN + json + RESULT_CLOSE)
}

async function main(): Promise<void> {
  const op = process.argv[2]
  const cwd = process.argv[3]
  const entryArg = process.argv[4]
  const entryAbs = path.resolve(cwd, entryArg)

  // Resolve the ORM from the PROJECT (not from pylon-dev's own deps) — the crux of
  // one-instance-without-a-bundle. ESM resolution anchored at the entry: the package
  // is ESM-only (`exports.import`), so this must go through import.meta.resolve, not
  // `require.resolve`. The entry (imported below) resolves the same specifier from
  // the same place → one instance, one registry.
  const entryUrl = pathToFileURL(entryAbs).href
  const ormUrl = import.meta.resolve('@getcronit/pylon-db', entryUrl)
  const orm = (await import(ormUrl)) as {
    toIR?: () => unknown
    allModels?: () => Array<{
      abstract?: boolean
      ctor: {name: string}
      tableName: string
      app?: string
      tenantColumn?: string
      secure?: boolean
    }>
  }

  // Importing the entry runs its top-level → constructs `new Pylon(...)` → registers
  // every model/queue into the ORM instance resolved above. v3 entries don't serve
  // on import (serving is a boot-time config plugin), so this is side-effect-safe.
  await import(entryUrl)

  switch (op) {
    case 'introspect': {
      // Everything the AppModel needs, serialized: the entity IR, per-model authz/
      // tenant shape (from the ORM registry), and declared queues (from the project's
      // pylon-queues, if any). The parent runs type-introspection + assembles.
      const ir = typeof orm.toIR === 'function' ? orm.toIR() : null
      const authz = (orm.allModels?.() ?? [])
        .filter(m => !m.abstract)
        .map(m => ({
          model: m.ctor.name,
          table: m.tableName,
          app: m.app,
          tenant: m.tenantColumn,
          secure: Boolean(m.secure)
        }))
      const queues = await introspectQueues(entryUrl)
      emit({ok: true, result: {ir, authz, queues}})
      return
    }
    case 'db': {
      // The migration command runs HERE, against the project's own ORM (resolved
      // above) — one instance, real migration files. The parent formats the result.
      const options = JSON.parse(process.argv[5] ?? '{}')
      const result = await runDbCommandCore(orm as unknown as ProjectApp, options)
      emit({ok: true, result})
      return
    }
    default:
      emit({ok: false, error: `unknown runner op: ${op}`})
      process.exitCode = 1
  }
}

/** Declared queues from the project's OWN pylon-queues (empty if it isn't used). */
async function introspectQueues(entryUrl: string): Promise<unknown[]> {
  try {
    const q = (await import(import.meta.resolve('@getcronit/pylon-queues', entryUrl))) as {
      registeredQueues?: () => Array<{name: string; describe?: () => unknown}>
    }
    return (q.registeredQueues?.() ?? []).map(d =>
      d.describe ? d.describe() : {name: d.name, hasSchema: false}
    )
  } catch {
    return [] // project doesn't depend on pylon-queues
  }
}

main().catch((e: unknown) => {
  emit({ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e)})
  process.exitCode = 1
})
