// docs/coverage/check.mjs
//
// Docs coverage check: diffs Pylon's EXTRACTED feature surface against the docs
// corpus and fails on gaps. Run with `node docs/coverage/check.mjs` (Node 18+, no
// deps, no build step — parses TS source as text).
//
// Four checks:
//   A. API coverage   — every public export / namespace member is mentioned in docs
//   B. CLI coverage    — every `pylon` (sub)command appears in reference/cli.md
//   C. Config coverage — every PylonConfig key appears in reference/config.md
//   D. Rot (warning)   — a docs code block imports a name a package no longer exports
//
// A/B/C are hard failures (exit 1). D is advisory (never fails the build) because
// docs legitimately import from runtime entry points this checker may not parse.

import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join, relative, resolve} from 'node:path'
import {
  REPO_ROOT_FROM_HERE,
  DOCS_GLOB_DIR,
  CLI_DOC,
  CONFIG_DOC,
  PACKAGES,
  QUALIFY_ONLY,
  CLI_SOURCE,
  CLI_INTERNAL,
  CONFIG_SOURCE,
  CONFIG_TYPE
} from './registry.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, REPO_ROOT_FROM_HERE)
const read = p => readFileSync(join(ROOT, p), 'utf8')

// ── source parsing (text-level; no TS compiler) ───────────────────────────────

/** Direct exports of one file's text, split into runtime values and type-only names.
 *  Handles `export {a, type B}`, `export type {C}`, `export function/const/class`,
 *  `export type/interface X`. Does NOT follow re-exports — see collectExports. */
function parseDirectExports(text) {
  const values = new Set()
  const types = new Set()

  const blockRe = /export\s+(type\s+)?\{([\s\S]*?)\}/g
  let m
  while ((m = blockRe.exec(text))) {
    const typeBlock = !!m[1] // `export type { ... }`
    for (let entry of m[2].split(',')) {
      entry = entry.replace(/\/\/.*$/gm, '').trim()
      if (!entry) continue
      const isType = typeBlock || entry.startsWith('type ')
      entry = entry.replace(/^type\s+/, '')
      const as = entry.match(/\bas\s+([A-Za-z_$][\w$]*)/)
      const name = as ? as[1] : entry.split(/\s+/)[0]
      ;(isType ? types : values).add(name)
    }
  }

  let d
  const valDecl =
    /export\s+(?:async\s+)?(?:function\*?|const|let|var|(?:abstract\s+)?class)\s+([A-Za-z_$][\w$]*)/g
  while ((d = valDecl.exec(text))) values.add(d[1])
  const typeDecl = /export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/g
  while ((d = typeDecl.exec(text))) types.add(d[1])

  return {values, types, text}
}

/** Resolve a relative module specifier to a source file on disk. */
function resolveRel(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec)
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx')
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

/** Collect a file's exports, FOLLOWING relative `export * from './x'` /
 *  `export {a} from './x'` re-exports one level deep (recursively, bounded). Non-relative
 *  re-exports (`@/…`, bare packages) are treated as internal and not followed. */
function collectExports(absFile, seen = new Set()) {
  const values = new Set()
  const types = new Set()
  if (seen.has(absFile) || !existsSync(absFile)) return {values, types}
  seen.add(absFile)

  const text = readFileSync(absFile, 'utf8')
  const direct = parseDirectExports(text)
  for (const v of direct.values) values.add(v)
  for (const t of direct.types) types.add(t)

  // export * from './rel'   and   export * as NS from './rel' (NS is the value)
  const starRe = /export\s+\*\s+(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s+['"](\.[^'"]+)['"]/g
  let s
  while ((s = starRe.exec(text))) {
    if (s[1]) {
      values.add(s[1]) // namespaced star re-export is itself a value
      continue
    }
    const target = resolveRel(absFile, s[2])
    if (target) {
      const sub = collectExports(target, seen)
      for (const v of sub.values) values.add(v)
      for (const t of sub.types) types.add(t)
    }
  }
  return {values, types}
}

/** Members of an object literal `const NAME = { ... }` as a Map of key → flat alias
 *  (the last segment of the value, e.g. `ID: fields.id` → 'id'; shorthand → the key).
 *  Resolves one level of `...spread` into sibling object literals. Used for pylon-db's
 *  `models`/`db`/`migrations` namespaces so a member is "covered" by either the
 *  qualified form (`models.HasMany`) or the flat builder the docs may use (`hasMany`). */
function parseObjectMembers(text, constName, seen = new Set()) {
  const members = new Map()
  if (seen.has(constName)) return members
  seen.add(constName)

  const start = text.search(
    new RegExp(`(?:export\\s+)?const\\s+${constName}\\s*=\\s*\\{`)
  )
  if (start === -1) return members
  const open = text.indexOf('{', start)

  let depth = 0
  let end = open
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = text.slice(open + 1, end)

  let d = 0
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (d === 0) {
      const spread = trimmed.match(/^\.\.\.([A-Za-z_$][\w$]*)/)
      if (spread)
        for (const [k, v] of parseObjectMembers(text, spread[1], seen))
          members.set(k, v)
      const kv = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:\s*([\w.$]+)/)
      const shorthand = trimmed.match(/^([A-Za-z_$][\w$]*)\s*,/)
      if (kv) members.set(kv[1], kv[2].split('.').pop())
      else if (shorthand) members.set(shorthand[1], shorthand[1])
    }
    for (const ch of line) {
      if (ch === '{' || ch === '[' || ch === '(') d++
      else if (ch === '}' || ch === ']' || ch === ')') d--
    }
  }
  return members
}

// ── docs corpus ───────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.md')) out.push(p)
  }
  return out
}

const docFiles = walk(join(ROOT, DOCS_GLOB_DIR))
const docCorpus = docFiles.map(f => readFileSync(f, 'utf8')).join('\n')

const mentions = token =>
  new RegExp(`(?<![\\w.$])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(
    docCorpus
  )
/** A namespace member is covered by its qualified form (`models.Struct`), the flat
 *  builder the docs may use instead (`hasMany` for `models.HasMany`), or — unless it's
 *  a common English word — its bare form (`Struct`). */
const memberCovered = (ns, member, alias) => {
  if (new RegExp(`${ns}\\.${member}\\b`).test(docCorpus)) return true
  if (alias && alias !== member && mentions(alias)) return true
  if (QUALIFY_ONLY.has(member)) return false
  return mentions(member)
}

// ── check A: API coverage ─────────────────────────────────────────────────────

const undocumented = [] // {pkg, symbol}
const exportsByPkg = {} // pkg → Set of all known names (values+types) for the rot check

for (const [pkg, cfg] of Object.entries(PACKAGES)) {
  const values = new Set()
  const known = new Set() // values + types, for rot
  for (const entry of cfg.entries) {
    const {values: v, types: t} = collectExports(join(ROOT, entry))
    for (const name of v) {
      values.add(name)
      known.add(name)
    }
    for (const name of t) known.add(name)
  }
  exportsByPkg[pkg] = known

  if (cfg.mode === 'all-minus-internal') {
    const internal = new Set(cfg.internal)
    for (const sym of values) {
      if (internal.has(sym) || sym.startsWith('__')) continue
      if (!mentions(sym)) undocumented.push({pkg, symbol: sym})
    }
  } else if (cfg.mode === 'namespaces-plus-list') {
    const text = cfg.entries.map(read).join('\n')
    const internalMembers = new Set(cfg.internalMembers)
    for (const {name, object} of cfg.namespaces) {
      for (const [member, alias] of parseObjectMembers(text, object)) {
        if (internalMembers.has(`${name}.${member}`)) continue
        if (!memberCovered(name, member, alias))
          undocumented.push({pkg, symbol: `${name}.${member}`})
      }
    }
    for (const sym of cfg.publicFlat) {
      if (!values.has(sym))
        undocumented.push({pkg, symbol: `${sym} (⚠ not exported — stale registry)`})
      else if (!mentions(sym)) undocumented.push({pkg, symbol: sym})
    }
  }
}

// ── check B: CLI coverage ─────────────────────────────────────────────────────

const cliText = read(CLI_SOURCE)
const cliDoc = read(CLI_DOC)
const cliInternal = new Set(CLI_INTERNAL)
const commands = new Set()
let cm
const cmdRe = /\.command\(\s*['"]([\w-]+)['"]/g
while ((cm = cmdRe.exec(cliText))) commands.add(cm[1])
const undocumentedCmds = [...commands].filter(
  c => !cliInternal.has(c) && !new RegExp(`\\b${c}\\b`).test(cliDoc)
)

// ── check C: config coverage ──────────────────────────────────────────────────

const cfgText = read(CONFIG_SOURCE)
const cfgDoc = read(CONFIG_DOC)
const typeStart = cfgText.search(new RegExp(`type\\s+${CONFIG_TYPE}\\s*=\\s*\\{`))
const configKeys = new Set()
if (typeStart !== -1) {
  const open = cfgText.indexOf('{', typeStart)
  const close = cfgText.indexOf('}', open)
  for (const line of cfgText.slice(open + 1, close).split('\n')) {
    const k = line.trim().match(/^([A-Za-z_$][\w$]*)\??\s*:/)
    if (k) configKeys.add(k[1])
  }
}
const undocumentedKeys = [...configKeys].filter(
  k => !new RegExp(`\\b${k}\\b`).test(cfgDoc)
)

// ── check D: rot (advisory) ───────────────────────────────────────────────────

const rot = [] // {file, pkg, name}
for (const file of docFiles) {
  const text = readFileSync(file, 'utf8')
  // `[^\n]*` tolerates an info string (```ts title="src/index.ts") after the language.
  const fenceRe = /```(?:ts|tsx|typescript)[^\n]*\n([\s\S]*?)```/g
  let f
  while ((f = fenceRe.exec(text))) {
    const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](@getcronit\/[\w-]+)/g
    let im
    while ((im = importRe.exec(f[1]))) {
      const pkg = im[2]
      const known = exportsByPkg[pkg]
      if (!known) continue // subpath / unparsed entry — don't guess
      for (let name of im[1].split(',')) {
        name = name.replace(/\btype\s+/, '').split(/\s+as\s+/)[0].trim()
        if (name && !known.has(name))
          rot.push({file: relative(ROOT, file), pkg, name})
      }
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────────

const bold = s => `\x1b[1m${s}\x1b[0m`
const red = s => `\x1b[31m${s}\x1b[0m`
const yellow = s => `\x1b[33m${s}\x1b[0m`
const green = s => `\x1b[32m${s}\x1b[0m`

console.log(bold('\nPylon docs coverage\n'))

let failed = false

if (undocumented.length) {
  failed = true
  console.log(red(`✗ ${undocumented.length} undocumented public API symbol(s):`))
  const byPkg = {}
  for (const {pkg, symbol} of undocumented) (byPkg[pkg] ??= []).push(symbol)
  for (const [pkg, syms] of Object.entries(byPkg)) {
    console.log(`  ${bold(pkg)}`)
    for (const s of syms.sort()) console.log(`    · ${s}`)
  }
  console.log()
} else {
  console.log(green('✓ API — every public export is mentioned in the docs'))
}

if (undocumentedCmds.length) {
  failed = true
  console.log(red(`✗ CLI commands missing from ${CLI_DOC}:`))
  for (const c of undocumentedCmds.sort()) console.log(`    · pylon ${c}`)
  console.log()
} else {
  console.log(green('✓ CLI — every command is in the CLI reference'))
}

if (undocumentedKeys.length) {
  failed = true
  console.log(red(`✗ Config keys missing from ${CONFIG_DOC}:`))
  for (const k of undocumentedKeys.sort()) console.log(`    · ${k}`)
  console.log()
} else {
  console.log(green('✓ Config — every PylonConfig key is in the config reference'))
}

if (rot.length) {
  console.log(
    yellow(`\n⚠ ${rot.length} possibly-stale import(s) in docs code blocks:`)
  )
  for (const {file, pkg, name} of rot)
    console.log(`    · ${file}: '${name}' not exported by ${pkg}`)
  console.log(
    yellow(
      '  (advisory — may be a runtime/subpath export this checker does not parse)'
    )
  )
}

console.log()
if (failed) {
  console.log(red(bold('Coverage check failed.')))
  process.exit(1)
}
console.log(green(bold('Coverage check passed.')))
