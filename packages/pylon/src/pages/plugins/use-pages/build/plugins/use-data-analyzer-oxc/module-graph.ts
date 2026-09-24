/**
 * Whole-program module graph over oxc-resolver + oxc's import/export tables.
 *
 * Its one job: resolve a local name (a called helper, a JSX component tag) to the
 * function node that DEFINES it — across files, import aliases, barrel re-exports,
 * default exports, and `memo`/`forwardRef`/HOC wrappers — with no type checker.
 * This is what the ts-morph analyzer used `getSymbol` + `findReferences` for.
 */
import * as fs from 'fs'
import {ResolverFactory} from 'oxc-resolver'
import {isFn, unwrap} from './ast'
import {parseFile, type ParsedFile} from './parse'
import {buildFileScope, type FileScope, type LocalBinding} from './scope'

export interface FnLocation {
  file: string
  /** FunctionDeclaration / ArrowFunctionExpression / FunctionExpression node. */
  node: any
}

export type ResolvedName =
  | {kind: 'fn'; file: string; node: any}
  | {kind: 'external'} // node_modules or unresolvable — treat as opaque
  | {kind: 'value'; file: string; binding: LocalBinding} // a local value, not a fn

/** Join a relative specifier onto a directory, resolving `.`/`..` segments. */
function normalizeJoin(dir: string, rel: string): string {
  const parts = dir.split('/')
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

export class ModuleGraph {
  private resolver: ResolverFactory
  private scopeCache = new Map<string, {hash: string; scope: FileScope}>()
  private parsedCache = new Map<string, ParsedFile>()
  /** In-memory source overlay (primed entry files / bundler-provided text). Used
   *  before disk so analysis works without writing files, and so dev serves the
   *  live buffer rather than stale disk. */
  private overlay = new Map<string, string>()
  /** reverse edges: file -> set of files that import it (for dev invalidation). */
  readonly importers = new Map<string, Set<string>>()
  /**
   * Cross-call function-summary cache (persists across pages in a build). Keyed by
   * fn id; each entry records the content hashes of every file its summary depended
   * on, so it's reused only while all of them are unchanged. Holds only acyclic,
   * seed-free summaries (the safe, reusable ones). Value is `Summary` (typed `any`
   * here to avoid a cycle with the interpreter module).
   */
  readonly summaryCache = new Map<string, {summary: any; deps: string[]; hashes: string[]}>()

  constructor(opts: {tsconfig?: string} = {}) {
    this.resolver = new ResolverFactory({
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'],
      conditionNames: ['node', 'import', 'default'],
      ...(opts.tsconfig ? {tsconfig: {configFile: opts.tsconfig, references: 'auto'}} : {})
    })
  }

  /** Parse + scope a file, memoized by content hash. Reads from disk if needed. */
  getFile(file: string, text?: string): ParsedFile | null {
    let src = text
    if (src !== undefined) this.overlay.set(file, src)
    if (src === undefined) src = this.overlay.get(file)
    if (src === undefined) {
      try {
        src = fs.readFileSync(file, 'utf8')
      } catch {
        return null
      }
    }
    const parsed = parseFile(file, src)
    this.parsedCache.set(file, parsed)
    return parsed
  }

  /** Content hash of a file (its parsed hash), or '' if unreadable. */
  hashOf(file: string): string {
    return this.getFile(file)?.hash ?? ''
  }

  getScope(file: string, text?: string): FileScope | null {
    const parsed = this.getFile(file, text)
    if (!parsed) return null
    const cached = this.scopeCache.get(file)
    if (cached && cached.hash === parsed.hash) return cached.scope
    const scope = buildFileScope(parsed)
    this.scopeCache.set(file, {hash: parsed.hash, scope})
    return scope
  }

  /** Resolve a module specifier from `fromFile` to an absolute path, or null for
   *  node_modules / unresolvable. */
  resolveSpecifier(fromFile: string, specifier: string): string | null {
    const dir = fromFile.slice(0, fromFile.lastIndexOf('/'))
    // Overlay-first for relative specifiers (in-memory graphs / tests).
    if (specifier.startsWith('.')) {
      const base = normalizeJoin(dir, specifier)
      const exts = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
      for (const e of exts) {
        const cand = base + e
        if (this.overlay.has(cand)) {
          const edge = this.importers.get(cand) ?? new Set()
          edge.add(fromFile)
          this.importers.set(cand, edge)
          return cand
        }
      }
    }
    try {
      const r = this.resolver.sync(dir, specifier)
      if (!r.path) return null
      if (r.path.includes('/node_modules/')) return null
      const edge = this.importers.get(r.path) ?? new Set()
      edge.add(fromFile)
      this.importers.set(r.path, edge)
      return r.path
    } catch {
      return null
    }
  }

  /**
   * Reduce an expression to the function it denotes: a direct function, an
   * identifier (resolve it), or a HOC-style wrapper `Hoc(Inner)` — memo/forwardRef
   * and generic custom HOCs alike — by unwrapping its first function/identifier arg.
   * This is called only when resolving something used as a component or callee, so a
   * one-arg call resolving to a function is what we want; a non-fn arg is left alone.
   */
  private unwrapHoc(node: any, scope: FileScope): FnLocation | null {
    const e = unwrap(node)
    if (!e) return null
    if (isFn(e)) return {file: scope.file, node: e}
    if (e.type === 'CallExpression') {
      const arg = e.arguments?.[0]
      const inner = arg ? unwrap(arg) : null
      if (inner && isFn(inner)) return {file: scope.file, node: inner}
      if (inner?.type === 'Identifier') {
        const r = this.resolveName(scope, inner.name)
        if (r.kind === 'fn') return {file: r.file, node: r.node}
      }
      return null
    }
    if (e.type === 'Identifier') {
      const r = this.resolveName(scope, e.name)
      if (r.kind === 'fn') return {file: r.file, node: r.node}
    }
    return null
  }

  /** Resolve a local name to a defining function (or external / value). */
  resolveName(scope: FileScope, name: string, seen = new Set<string>()): ResolvedName {
    // local declaration? (a function decl, or a var whose init denotes a fn/HOC)
    const local = scope.decls.get(name)
    if (local) {
      const fn = this.unwrapHoc(local.init ?? local.node, scope)
      if (fn) return {kind: 'fn', file: fn.file, node: fn.node}
      return {kind: 'value', file: scope.file, binding: local}
    }

    // import?
    const imp = scope.imports.get(name)
    if (imp) {
      if (imp.isType) return {kind: 'external'}
      const target = this.resolveSpecifier(scope.file, imp.source)
      if (!target) return {kind: 'external'}
      const wanted = imp.imported === 'default' ? '#default' : imp.imported
      if (imp.imported === 'namespace') return {kind: 'external'}
      return this.resolveExport(target, wanted, seen)
    }

    return {kind: 'external'}
  }

  /** Resolve `NS.member` where `NS` is a namespace import (`import * as NS`). */
  resolveNamespaceMember(scope: FileScope, ns: string, member: string): ResolvedName {
    const imp = scope.imports.get(ns)
    if (!imp || imp.imported !== 'namespace') return {kind: 'external'}
    const target = this.resolveSpecifier(scope.file, imp.source)
    if (!target) return {kind: 'external'}
    return this.resolveExport(target, member)
  }

  /** Resolve `exportName` ('#default' for default) in `file` to a defining fn,
   *  following barrel re-exports. */
  resolveExport(file: string, exportName: string, seen = new Set<string>()): ResolvedName {
    const key = file + '::' + exportName
    if (seen.has(key)) return {kind: 'external'}
    seen.add(key)

    const scope = this.getScope(file)
    if (!scope) return {kind: 'external'}

    if (exportName === '#default') {
      if (scope.defaultExportLocal) {
        return this.resolveName(scope, scope.defaultExportLocal, seen)
      }
      if (scope.defaultExportNode) {
        const fn = this.unwrapHoc(scope.defaultExportNode, scope)
        if (fn) return {kind: 'fn', file: fn.file, node: fn.node}
      }
      return {kind: 'external'}
    }

    const named = scope.exportsByName.get(exportName)
    if (named) {
      if (named.local) return this.resolveName(scope, named.local, seen)
      if (named.reExport) {
        const target = this.resolveSpecifier(file, named.reExport.source)
        if (target) return this.resolveExport(target, named.reExport.imported, seen)
      }
    }

    // A bare local declaration exported via `export function`/`export const`.
    if (scope.decls.has(exportName)) return this.resolveName(scope, exportName, seen)

    // barrel `export * from`
    for (const re of scope.reExportAll) {
      const target = this.resolveSpecifier(file, re.source)
      if (!target) continue
      const found = this.resolveExport(target, exportName, seen)
      if (found.kind === 'fn') return found
    }

    return {kind: 'external'}
  }

  invalidate(file: string): void {
    this.scopeCache.delete(file)
    this.parsedCache.delete(file)
  }
}
