/**
 * The ORM model-loading bridge, shared by `pylon db` and `pylon build`.
 *
 * The ORM's IR/registry only exists after the `@model()` decorators run, so any
 * consumer that needs it must EXECUTE the user's models — in the project's
 * module context, so the decorators populate the same `@getcronit/pylon-db`
 * instance we then read.
 *
 * Critically, we do NOT import the entry as-is: that would run its top-level
 * `serve(app)` / `Deno.serve(...)` and start a server during the build. Instead
 * we load a side-effect-stripped view of the entry (declarations + imports, no
 * serve, no default export) and re-export the project's pylon-orm. One native
 * ESM import yields a populated registry plus the API, from a single instance —
 * and no server starts. Runtime-agnostic, since every runtime's entrypoint form
 * is among the dropped statements.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {prepareModelSource} from './builder/prepare-model-source.js'
import {pathToFileURL} from 'node:url'
import esbuild from 'esbuild'
import type {PylonIR} from '@getcronit/pylon-ir'

/** The slice of `@getcronit/pylon-db` the dev tooling drives. Typed locally so
 *  pylon-dev needn't take a runtime dependency on the ORM. */
export interface ProjectOrm {
  toIR(): PylonIR
  MigrationRunner: new (opts: {dir: string}) => {
    status(
      load: (filePath: string) => Promise<unknown>,
      db?: unknown
    ): Promise<{
      pendingChanges: unknown[]
      migrations: string[]
      unapplied: string[]
    }>
    generate(
      name: string,
      load: (filePath: string) => Promise<unknown>,
      opts?: {renames?: Array<{table: string; from: string; to: string}>}
    ): Promise<{
      name: string
      changes: unknown[]
      renameCandidates: Array<{table: string; from: string; to: string}>
    } | null>
    apply(load: (filePath: string) => Promise<unknown>, db?: unknown): Promise<string[]>
    rollback(
      load: (filePath: string) => Promise<unknown>,
      db?: unknown,
      opts?: {steps?: number}
    ): Promise<string[]>
    markApplied(
      name: string,
      load: (filePath: string) => Promise<unknown>,
      db?: unknown
    ): Promise<void>
    markRolledBack(name: string, db?: unknown): Promise<void>
    plan(
      load: (filePath: string) => Promise<unknown>,
      direction?: 'up' | 'down'
    ): Promise<Array<{name: string; statements: string[]}>>
    integrityErrors(load: (filePath: string) => Promise<unknown>, db?: unknown): Promise<string[]>
  }
  connect(opts: {connectionString: string}): unknown
  /** Presence-level drift between the live DB and the current models. */
  schemaDrift(db?: unknown): Promise<{
    missingTables: string[]
    extraTables: string[]
    columns: Array<{table: string; missing: string[]; extra: string[]}>
  }>
  hasDrift(d: {missingTables: string[]; extraTables: string[]; columns: unknown[]}): boolean
  /** Create tables for all models directly (no migration) — `db push`. */
  syncSchema(): Promise<void>
}

let counter = 0

export async function loadProjectOrm(
  cwd: string,
  modelsEntry: string
): Promise<ProjectOrm> {
  // Strip the entry's side effects (serve etc.) before loading, so executing it
  // registers models without starting a server. Imports inside the stripped
  // source resolve relative to the entry's own directory.
  const entryAbs = path.resolve(cwd, modelsEntry)
  const stripped = prepareModelSource(
    await fs.readFile(entryAbs, 'utf8'),
    path.basename(entryAbs)
  )

  // Unique temp name per call so a watch-mode re-import re-runs the models
  // (a fixed name would be cached by the ESM loader → stale registry).
  const tmp = path.join(cwd, `.pylon-orm-entry.${process.pid}.${counter++}.mjs`)
  await esbuild.build({
    stdin: {
      contents: `${stripped}\nexport * from '@getcronit/pylon-db'\n`,
      resolveDir: path.dirname(entryAbs),
      loader: 'ts',
      sourcefile: 'pylon-orm-entry.ts'
    },
    outfile: tmp,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false
      }
    }
  })

  try {
    return (await import(/* @vite-ignore */ pathToFileURL(tmp).href)) as unknown as ProjectOrm
  } finally {
    await fs.rm(tmp, {force: true})
  }
}

/**
 * Best-effort: the ORM's entity IR for a project, or `undefined` if the project
 * doesn't use the ORM (pylon-orm not resolvable, no models, or load failure).
 * Used by `pylon build` to feed `SchemaBuilder.build({contributeIR})`.
 */
export async function loadOrmContribution(
  cwd: string,
  modelsEntry: string
): Promise<PylonIR | undefined> {
  try {
    const orm = await loadProjectOrm(cwd, modelsEntry)
    if (typeof orm.toIR !== 'function') return undefined
    const ir = orm.toIR()
    return Object.keys(ir.entities).length > 0 ? ir : undefined
  } catch {
    return undefined
  }
}
