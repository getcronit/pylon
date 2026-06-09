/**
 * `pylon db` — schema migrations driven by the ORM's IR.
 *
 * The crux is loading the user's models so their `@model()` decorators populate
 * the registry, then driving the migration runner on the SAME
 * `@getcronit/pylon-orm` instance the models registered into. We do this
 * in-process: bundle the models entry to a temp ESM file *inside the project*
 * (so its bare imports resolve against the project's node_modules), import it,
 * then resolve the project's pylon-orm and drive `MigrationRunner` from it.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import esbuild from 'esbuild'

export interface DbCommandOptions {
  command: 'status' | 'diff' | 'migrate'
  /** Migration name (for `diff`). */
  name?: string
  /** Entry that imports the models (default `./src/index.ts`). */
  models?: string
  /** Migrations directory (default `./migrations`). */
  dir?: string
  /** Project root (default `process.cwd()`). */
  cwd?: string
}

export interface DbCommandResult {
  command: DbCommandOptions['command']
  /** `diff`: created migration name (or null). `migrate`: applied names. */
  created?: string | null
  applied?: string[]
  status?: {pendingChanges: unknown[]; migrations: string[]; unapplied: string[]}
}

/**
 * The slice of `@getcronit/pylon-orm`'s public API this command drives. Typed
 * locally so pylon-dev needn't take a (reverse) dependency on the ORM — the
 * real instance is resolved at runtime from the user's project.
 */
interface ProjectOrm {
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

async function loadProjectOrm(cwd: string, modelsEntry: string): Promise<ProjectOrm> {
  // Bundle a driver that (a) imports the models so their @model() decorators
  // run, and (b) re-exports the project's pylon-orm. Keeping pylon-orm external
  // means the models' import and the re-export resolve to ONE instance — so the
  // runner we read is the one the models registered into. Output lands inside
  // the project so the external import resolves against its node_modules.
  const tmp = path.join(cwd, '.pylon-db-entry.mjs')
  await esbuild.build({
    stdin: {
      contents:
        `import ${JSON.stringify(modelsEntry)}\n` +
        `export * from '@getcronit/pylon-orm'\n`,
      resolveDir: cwd,
      loader: 'ts',
      sourcefile: 'pylon-db-entry.ts'
    },
    outfile: tmp,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
    // Match the ORM's decorator/field semantics: `@model()` is a legacy
    // decorator, and field-builder harvesting relies on field initializers
    // running (NOT `useDefineForClassFields`).
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false
      }
    }
  })

  try {
    // `@vite-ignore` keeps this a NATIVE dynamic import (a Vite/vitest host
    // would otherwise intercept and mis-resolve the temp file's externals).
    return (await import(/* @vite-ignore */ pathToFileURL(tmp).href)) as unknown as ProjectOrm
  } finally {
    await fs.rm(tmp, {force: true})
  }
}

export async function runDbCommand(
  options: DbCommandOptions
): Promise<DbCommandResult> {
  const cwd = options.cwd ?? process.cwd()
  const modelsEntry = path.resolve(cwd, options.models ?? './src/index.ts')
  const dir = path.resolve(cwd, options.dir ?? './migrations')

  const orm = await loadProjectOrm(cwd, modelsEntry)
  const runner = new orm.MigrationRunner({dir})

  switch (options.command) {
    case 'status': {
      const status = await runner.status()
      return {command: 'status', status}
    }
    case 'diff': {
      const created = await runner.generate(options.name ?? 'migration')
      return {command: 'diff', created: created?.name ?? null}
    }
    case 'migrate': {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('pylon db migrate requires DATABASE_URL to be set.')
      }
      orm.connect({connectionString})
      const applied = await runner.apply()
      return {command: 'migrate', applied}
    }
  }
}
