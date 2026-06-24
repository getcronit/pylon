/**
 * Registration discovery.
 *
 * A `@model()` / `@queue()` class only registers when its module is EVALUATED, and
 * JS modules are lazy — so a decorated class in a file no import reaches is silently
 * dropped from the schema, the DDL, and the IR (the classic "db push made no tables"
 * footgun). Rather than trust the entry's import graph, the build discovers every
 * model/queue module under the source root and loads them all.
 *
 * Detection is deliberately broad-but-safe: a file qualifies only if it BOTH shows a
 * model/queue signal (a `@…model(`/`@…queue(` decorator or `extends …Model`/`…Queue`)
 * AND imports from `@getcronit/pylon-db` / `@getcronit/pylon-queues`. The pylon-import
 * requirement rules out false positives (e.g. an unrelated `class X extends Queue`),
 * and including an extra real model module is harmless (esbuild dedupes; the entry's
 * own modules are loaded anyway).
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'

const SIGNAL =
  /@\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:model|queue)\s*\(|class\s+[A-Za-z_$][\w$]*\s+extends\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:Model|Queue)\b/
const PYLON_IMPORT = /from\s*['"]@getcronit\/pylon-(?:db|queues)['"]/

const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build'])

function isSource(name: string): boolean {
  if (name.endsWith('.d.ts')) return false
  if (/\.(test|spec)\.[mc]?tsx?$/.test(name)) return false
  return /\.[mc]?tsx?$/.test(name)
}

/**
 * Absolute paths of every model/queue module under `root`, excluding the entry
 * (already loaded), build output, tests, and declarations. Sorted for determinism.
 */
export async function discoverRegistrationModules(
  root: string,
  entryAbs: string
): Promise<string[]> {
  const entry = path.resolve(entryAbs)
  const out: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, {withFileTypes: true})
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !IGNORE_DIRS.has(e.name)) await walk(full)
        continue
      }
      if (!isSource(e.name)) continue
      if (path.resolve(full) === entry) continue
      let src: string
      try {
        src = await fs.readFile(full, 'utf8')
      } catch {
        continue
      }
      if (SIGNAL.test(src) && PYLON_IMPORT.test(src)) out.push(path.resolve(full))
    }
  }

  await walk(root)
  return out.sort()
}

/**
 * Side-effect `import` statements that load every discovered module, with paths
 * relative to `fromDir` (the entry's directory) so they resolve in a bundle whose
 * `resolveDir` is that directory. Empty string when nothing was discovered.
 */
export function importStatements(modules: string[], fromDir: string): string {
  return modules
    .map(file => {
      const rel = './' + path.relative(fromDir, file).replace(/\\/g, '/')
      return `import ${JSON.stringify(rel)}\n`
    })
    .join('')
}
