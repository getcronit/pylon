import {existsSync} from 'fs'
import path from 'path'

const CONFIG_FILES = [
  'pylon.config.ts',
  'pylon.config.mts',
  'pylon.config.js',
  'pylon.config.mjs'
]

/**
 * Absolute path to the project's `pylon.config.*`, or `null` if none exists.
 *
 * The server isn't bundled, so there's no bundled config artifact: the build-time plugin
 * read imports this file in-process via tsx (see `Bundler.initBuildPlugins`), and the
 * runtime config is this file itself (dev, via the loader) or its transpiled
 * `.pylon/pylon.config.js` (build).
 */
export function findConfigFile(cwd: string): string | null {
  return CONFIG_FILES.map(f => path.join(cwd, f)).find(existsSync) ?? null
}
