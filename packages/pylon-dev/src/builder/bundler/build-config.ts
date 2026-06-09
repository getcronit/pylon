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
 * Produce `.pylon/config.js` (exporting `config`) from a standalone
 * `pylon.config.{ts,js}` in the project root.
 *
 * Config used to be a `config` export extracted out of the entry (`src/index.ts`)
 * — which required statically tree-shaking it away from `serve(app)` and the
 * rest of the app. A dedicated config file is side-effect-free by construction,
 * so we just bundle it directly: no extraction, no executing the app, and it
 * loads identically on every runtime the build targets.
 *
 * A `default` export OR a named `config` export is accepted and normalized to
 * the named `config` export the rest of the pipeline (build plugins, the
 * injected runtime, analytics) already consumes. When no config file exists, an
 * empty config is written so those consumers keep working.
 */
export async function buildConfigFile(
  cwd: string,
  outputFile: string
): Promise<void> {
  await mkdir(path.dirname(outputFile), {recursive: true})

  const configFile = CONFIG_FILES.map(f => path.join(cwd, f)).find(existsSync)

  if (!configFile) {
    await writeFile(outputFile, 'export const config = {}\n')
    return
  }

  await esbuild.build({
    stdin: {
      contents:
        `import * as mod from ${JSON.stringify(configFile)}\n` +
        `export const config = mod.default ?? mod.config ?? {}\n`,
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
