// Feature-boundary guard. The build externalizes cross-FEATURE imports written as
// the `@getcronit/pylon/<feature>` self-ref (one shared copy at runtime via the
// exports map), but BUNDLES relative imports. So a relative import that crosses a
// feature boundary (e.g. `src/db/x.ts` importing `../auth/contract`) silently INLINES
// that feature into the consumer — duplicating it into every bundle and breaking
// singletons (the model registry, the auth principal symbol, async context).
//
// This guard fails on any such relative import. Fix by switching to the self-ref:
//   import {X} from '../auth/contract'   ->   import {X} from '@getcronit/pylon/auth/contract'
//
// See rfcs/BUILD_DEV_PIPELINE.md ("enforce the self-ref boundary").
import fs from 'fs'
import path from 'path'
import cp from 'child_process'
import {fileURLToPath} from 'url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(PKG, 'src')

// Top-level src dirs that bundle together as one unit. Relative imports WITHIN a
// group are fine; across groups they inline one feature into another.
const CORE_GROUP = new Set(['core', 'app', 'plugins'])
const groupOf = top => (CORE_GROUP.has(top) ? 'core' : top)

// The ONLY cross-group targets that may be imported relatively — intentionally
// bundled-in and stateless: the IR module and the query BUILD tooling. Everything
// else (db, auth, queues, pages, the query runtime, core from outside the cluster)
// MUST use the self-ref so the build keeps it external. Adding to this set is an
// explicit, reviewable "this feature is safe to inline" decision.
const allowsRelative = t =>
  t === 'ir' || t.startsWith('ir/') || t === 'query/build' || t.startsWith('query/build/')

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']
const resolvesToFile = noExt => EXTS.some(e => fs.existsSync(noExt + e))

const files = cp
  .execSync('git ls-files src', {cwd: PKG})
  .toString()
  .trim()
  .split('\n')
  .filter(f => /\.(ts|tsx)$/.test(f) && !/\.(test|bench)\./.test(f))

const violations = []
for (const rel of files) {
  const abs = path.join(PKG, rel)
  const group = groupOf(rel.split('/')[1]) // src/<top>/...
  const source = fs.readFileSync(abs, 'utf8')

  const specs = []
  // static import/export ... from '...'  (line-anchored → skips ` * import` in JSDoc)
  for (const m of source.matchAll(/^[ \t]*(?:import|export)\b[^\n]*?\bfrom\s*['"](\.\.?\/[^'"]+)['"]/gm))
    specs.push(m[1])
  // dynamic import('...')
  for (const m of source.matchAll(/\bimport\s*\(\s*['"](\.\.?\/[^'"]+)['"]/g)) specs.push(m[1])

  for (const spec of specs) {
    const noExt = path.resolve(path.dirname(abs), spec).replace(/\.(ts|tsx|js|jsx)$/, '')
    if (!resolvesToFile(noExt)) continue // phantom path (e.g. a comment example)
    const target = path.relative(SRC, noExt)
    if (target.startsWith('..')) continue // escapes src entirely (n/a)
    if (groupOf(target.split('/')[0]) === group) continue // same bundle group
    if (allowsRelative(target)) continue // intentionally bundled-in target
    violations.push({file: rel, spec, target})
  }
}

if (violations.length) {
  console.error(
    '✖ feature-boundary violations — a relative import crosses a feature boundary,\n' +
      '  which would INLINE that feature into this bundle (duplication + broken singletons).\n' +
      '  Use the `@getcronit/pylon/<feature>` self-ref instead so the build keeps it external.\n'
  )
  for (const v of violations) console.error(`  ${v.file}\n    '${v.spec}'  →  src/${v.target}`)
  console.error(
    '\n  If a NEW bundled-in target is genuinely intended, add it to `allowsRelative`\n' +
      '  in scripts/check-boundaries.mjs (a reviewable decision).'
  )
  process.exit(1)
}
console.log(`✓ feature boundaries clean — ${files.length} files, no cross-feature relative imports`)
