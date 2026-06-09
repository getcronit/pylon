/**
 * The ORM model-loading bridge, shared by `pylon db` and `pylon build`.
 *
 * The ORM's IR/registry only exists after the `@model()` decorators run, so any
 * consumer that needs it must EXECUTE the user's models — in the project's
 * module context, so the decorators populate the same `@getcronit/pylon-orm`
 * instance we then read. We bundle a driver that imports the models and
 * re-exports the project's pylon-orm; one native ESM import yields a populated
 * registry plus the API, from a single instance.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import esbuild from 'esbuild'
import type {PylonIR} from '@getcronit/pylon-ir'

/** The slice of `@getcronit/pylon-orm` the dev tooling drives. Typed locally so
 *  pylon-dev needn't take a runtime dependency on the ORM. */
export interface ProjectOrm {
  toIR(): PylonIR
  MigrationRunner: new (opts: {dir: string}) => {
    status(): Promise<{
      pendingChanges: unknown[]
      migrations: string[]
      unapplied: string[]
    }>
    generate(name: string): Promise<{name: string} | null>
    apply(): Promise<string[]>
  }
  connect(opts: {connectionString: string}): unknown
}

let counter = 0

export async function loadProjectOrm(
  cwd: string,
  modelsEntry: string
): Promise<ProjectOrm> {
  // Unique temp name per call so a watch-mode re-import re-runs the models
  // (a fixed name would be cached by the ESM loader → stale registry).
  const tmp = path.join(cwd, `.pylon-orm-entry.${process.pid}.${counter++}.mjs`)
  await esbuild.build({
    stdin: {
      contents:
        `import ${JSON.stringify(modelsEntry)}\n` +
        `export * from '@getcronit/pylon-orm'\n`,
      resolveDir: cwd,
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
