// docs/coverage/check-examples.mjs
//
// ADVISORY, type-aware companion to check.mjs. Where check.mjs asks "is this symbol
// mentioned anywhere?", this asks the stronger question: "do the code examples still
// resolve against the REAL, current package types?" — the guarantee that makes a
// type-driven framework's docs trustworthy.
//
// It concatenates each page's ```ts/```tsx fences into one virtual module and type-checks
// it against the packages' shipped `.d.ts` (via a paths map — no install needed). Doc
// snippets are fragments (undefined vars, `...`, cross-fence references, imports of files
// that only exist conceptually), so a full compile is mostly noise. We therefore report
// ONLY the diagnostics that reliably signal real API drift in a @getcronit import:
//
//   2305 no exported member          → import of a removed/renamed export
//   2724 no exported member named X  → same, with a suggestion
//   2307 cannot find module          → ONLY for '@getcronit/*' (a dead package subpath);
//                                       relative/third-party misses are expected noise
//
// Member-level checks (TS2339 "property does not exist") are deliberately NOT reported:
// Pylon leans on dynamic types the snippets can't reconstruct — the ORM's
// `static objects = manager()`, relation managers, and the app-generated `Data`/
// `Mutations`/`Bindings` types are generic in docs — so 2339 here is ~all false positives.
// Flip ENABLE_MEMBER_CHECKS if you make the snippets self-contained enough to trust them.
//
// Run: `node docs/coverage/check-examples.mjs`  (needs the packages built: `pnpm build`).
// Kept OUT of the check:coverage gate on purpose — it depends on build state and is
// inherently fuzzier than the mention check.

import ts from 'typescript'
import {readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join, relative} from 'node:path'
import {REPO_ROOT_FROM_HERE, DOCS_GLOB_DIR} from './registry.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, REPO_ROOT_FROM_HERE)
const p = (...s) => join(ROOT, ...s)

// Package/subpath → shipped declaration file. Matches the `exports` map of the
// consolidated @getcronit/pylon package.
const PATHS = {
  '@getcronit/pylon': ['packages/pylon/dist/core/index.d.ts'],
  '@getcronit/pylon/db': ['packages/pylon/dist/db/index.d.ts'],
  '@getcronit/pylon/db/plugin': ['packages/pylon/dist/db/plugin.d.ts'],
  '@getcronit/pylon/ir': ['packages/pylon/dist/ir/index.d.ts'],
  '@getcronit/pylon/auth': ['packages/pylon/dist/auth/index.d.ts'],
  '@getcronit/pylon/auth/plugin': ['packages/pylon/dist/auth/plugin.d.ts'],
  '@getcronit/pylon/auth/contract': ['packages/pylon/dist/auth/contract.d.ts'],
  '@getcronit/pylon/auth/zitadel': ['packages/pylon/dist/auth/zitadel.d.ts'],
  '@getcronit/pylon/pages': ['packages/pylon/dist/pages/index.d.ts'],
  '@getcronit/pylon/pages/plugin': ['packages/pylon/dist/pages/plugin.d.ts'],
  '@getcronit/pylon/queues': ['packages/pylon/dist/queues/index.d.ts'],
  '@getcronit/pylon/queues/plugin': ['packages/pylon/dist/queues/plugin.d.ts'],
  '@getcronit/pylon/query': ['packages/pylon/dist/query/index.d.ts']
}

const ENABLE_MEMBER_CHECKS = false // TS2339/2551 — noisy against Pylon's dynamic types
const IMPORT_CODES = new Set([2305, 2724]) // no/renamed exported member — always real
const MEMBER_CODES = new Set([2339, 2551])
const REPORT = new Set([
  ...IMPORT_CODES,
  2307, // cannot find module — filtered to '@getcronit/*' below
  ...(ENABLE_MEMBER_CHECKS ? MEMBER_CODES : [])
])

// ── gather fences → one virtual module per page ───────────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (name.endsWith('.md')) out.push(f)
  }
  return out
}

/** Extract ```ts / ```tsx / ```typescript fence bodies (ignoring the info string). */
function extractFences(md) {
  const out = []
  const lines = md.split('\n')
  let inFence = false
  let buf = []
  for (const line of lines) {
    const open = line.match(/^```(ts|tsx|typescript)\b/)
    if (!inFence && open) {
      inFence = true
      buf = []
    } else if (inFence && /^```\s*$/.test(line)) {
      out.push(buf.join('\n'))
      inFence = false
    } else if (inFence) {
      buf.push(line)
    }
  }
  return out
}

const docsRoot = p(DOCS_GLOB_DIR)
const mdFiles = walk(docsRoot)

const TMP = join(HERE, '.examples-tmp')
rmSync(TMP, {recursive: true, force: true})
mkdirSync(TMP, {recursive: true})

const fileToPage = new Map()
const virtualFiles = []
for (const md of mdFiles) {
  const fences = extractFences(readFileSync(md, 'utf8'))
  if (!fences.length) continue
  const slug = relative(docsRoot, md).replace(/[/\\]/g, '__').replace(/\.md$/, '')
  const vf = join(TMP, `${slug}.tsx`)
  // Concatenate the page's fences: later fences routinely reference earlier ones.
  writeFileSync(vf, fences.join('\n\n'))
  virtualFiles.push(vf)
  fileToPage.set(vf, relative(ROOT, md))
}

// ── type-check ────────────────────────────────────────────────────────────────

const paths = Object.fromEntries(
  Object.entries(PATHS).map(([k, v]) => [k, v.map(rel => p(rel))])
)

const options = {
  noEmit: true,
  skipLibCheck: true,
  strict: false,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  allowJs: false,
  baseUrl: ROOT,
  paths,
  types: [],
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
  noImplicitAny: false
}

const program = ts.createProgram(virtualFiles, options)
const diagnostics = ts.getPreEmitDiagnostics(program)

const findings = []
for (const d of diagnostics) {
  if (!d.file || !REPORT.has(d.code)) continue
  const page = fileToPage.get(d.file.fileName)
  if (!page) continue // a diagnostic in a lib/.d.ts, not a doc snippet
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n')
  // "Cannot find module" is only drift when it's one of OUR packages — misses on
  // './models', './apps/blog', 'zod' etc. are expected (those files/deps aren't present).
  if (d.code === 2307 && !msg.includes('@getcronit/')) continue
  findings.push({page, code: d.code, msg})
}

rmSync(TMP, {recursive: true, force: true})

// ── report ────────────────────────────────────────────────────────────────────

const bold = s => `\x1b[1m${s}\x1b[0m`
const yellow = s => `\x1b[33m${s}\x1b[0m`
const green = s => `\x1b[32m${s}\x1b[0m`

console.log(bold('\nPylon docs — example type-check (advisory)\n'))

if (!findings.length) {
  console.log(green('✓ Every docs code example resolves against the current package types.'))
  console.log()
  process.exit(0)
}

console.log(
  yellow(`⚠ ${findings.length} example(s) reference APIs that no longer type-check:`)
)
const byPage = {}
for (const f of findings) (byPage[f.page] ??= []).push(f)
for (const [page, fs] of Object.entries(byPage)) {
  console.log(`  ${bold(page)}`)
  for (const f of fs) console.log(`    · TS${f.code}: ${f.msg}`)
}
console.log()
console.log(
  yellow('These are likely real API drift in the docs. Fix the snippet, or if this is a')
)
console.log(yellow('false positive from a fragment, see check-examples.mjs REPORT filter.'))
console.log()
process.exit(1)
