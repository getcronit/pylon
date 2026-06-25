import esbuild from 'esbuild'
import {existsSync} from 'fs'
import {mkdir, writeFile} from 'fs/promises'
import path from 'path'

const CONFIG_FILES = [
  'pylon.config.ts',
  'pylon.config.mts',
  'pylon.config.js',
  'pylon.config.mjs'
]

/**
 * The normalized `export const config` source for a project's `pylon.config.{ts,js}`
 * (or an empty config when none exists). Shared by BOTH the build-time plugin read and
 * the runtime config entry, so they resolve `default`/`config`/factory identically.
 *
 * Accepts any of: `export default {…} satisfies PylonConfig` (recommended),
 * `export default defineConfig(…)`, a named `config` export, or a (possibly async)
 * factory function — all normalized to the named `config` object the rest of the
 * pipeline (build plugins, the injected runtime, analytics) consumes.
 */
export function configEntrySource(cwd: string): string {
  const configFile = CONFIG_FILES.map(f => path.join(cwd, f)).find(existsSync)
  if (!configFile) return 'export const config = {}\n'
  return (
    `import * as mod from ${JSON.stringify(configFile)}\n` +
    `const resolved = mod.default ?? mod.config ?? {}\n` +
    // A factory (defineConfig(() => …)) is resolved here; objects pass through.
    `export const config = typeof resolved === 'function' ? await resolved() : resolved\n`
  )
}

/**
 * Write the RUNTIME config entry (a real file, so it can be one entryPoint of the split
 * server build). Emitting it alongside the app with `splitting:true` lets the model layer
 * it pulls in (via auth middleware etc.) land in a SHARED chunk both `index.js` and
 * `config.js` import — one class object — instead of a second inlined copy. The split's
 * `config.js` is what `index.js` loads at runtime (`await import('./config.js')`).
 */
export async function writeConfigEntry(cwd: string, entryFile: string): Promise<void> {
  await mkdir(path.dirname(entryFile), {recursive: true})
  await writeFile(entryFile, configEntrySource(cwd))
}

/**
 * Build a STANDALONE config bundle (exporting `config`). Used at BUILD time only, to read
 * `config.plugins` and set up the page build contexts BEFORE the server build runs. The
 * RUNTIME `config.js` is emitted by the split server build (see `writeConfigEntry`), so
 * this output goes to a separate path and its inlined models are harmless (discarded).
 */
export async function buildConfigFile(
  cwd: string,
  outputFile: string
): Promise<void> {
  await mkdir(path.dirname(outputFile), {recursive: true})

  await esbuild.build({
    stdin: {
      contents: configEntrySource(cwd),
      resolveDir: cwd,
      loader: 'ts',
      sourcefile: 'pylon-config-entry.ts'
    },
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent'
  })
}
