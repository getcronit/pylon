/**
 * Per-file symbol table: imports, top-level declarations, and exports. Built
 * mostly from oxc's module linkage table (no AST walk needed for import/export
 * linkage) plus one pass over the program body for local declarations.
 *
 * This is the syntactic replacement for the type checker's "go to definition":
 * combined with `module-graph.ts` it resolves any local name to its defining
 * node, across files, aliases, barrels, and default exports — without types.
 */
import {isFn} from './ast'
import type {ParsedFile} from './parse'

export interface ImportBinding {
  kind: 'import'
  /** Module specifier as written (`./Row`, `@/x`). */
  source: string
  /** 'default' | 'namespace' | the imported member name. */
  imported: 'default' | 'namespace' | string
  isType: boolean
}

export interface LocalBinding {
  kind: 'local'
  /** 'function' (decl / arrow / fn-expr / class), or 'var' for other values. */
  what: 'function' | 'var'
  /** The declaring node (FunctionDeclaration / VariableDeclarator / Class). */
  node: any
  /** Initializer expression for a `var` (arrow/fn/call/etc.), if any. */
  init?: any
}

export type TopBinding = ImportBinding | LocalBinding

export interface FileScope {
  file: string
  /** local name -> import linkage (from the oxc module table). */
  imports: Map<string, ImportBinding>
  /** top-level declared name -> its declaration. */
  decls: Map<string, LocalBinding>
  /** exportName -> local name it refers to (undefined local => re-export). */
  exportsByName: Map<string, {local?: string; reExport?: {source: string; imported: string}}>
  /** local name that is the default export, if any (`export default Foo`). */
  defaultExportLocal?: string
  /** the node directly default-exported when anonymous (`export default () => …`). */
  defaultExportNode?: any
  /** re-export-all sources (`export * from './barrel'`). */
  reExportAll: {source: string}[]
}

function importedFromKind(kind: string, name: string | null): 'default' | 'namespace' | string {
  if (kind === 'Default') return 'default'
  if (kind === 'NamespaceObject') return 'namespace'
  return name ?? ''
}

export function buildFileScope(parsed: ParsedFile): FileScope {
  const scope: FileScope = {
    file: parsed.path,
    imports: new Map(),
    decls: new Map(),
    exportsByName: new Map(),
    reExportAll: []
  }

  // ── Imports (straight from the module table) ──
  for (const imp of parsed.module.staticImports) {
    const source = imp.moduleRequest.value
    for (const e of imp.entries) {
      scope.imports.set(e.localName.value, {
        kind: 'import',
        source,
        imported: importedFromKind(e.importName.kind, e.importName.name),
        isType: e.isType
      })
    }
  }

  // ── Exports (straight from the module table) ──
  for (const exp of parsed.module.staticExports) {
    for (const e of exp.entries) {
      const req = e.moduleRequest?.value
      if (e.exportName.kind === 'Default') {
        if (e.localName.kind === 'Name' && e.localName.name) {
          scope.defaultExportLocal = e.localName.name
        }
        continue
      }
      if (req && e.exportName.kind === 'None' && e.importName.kind === 'AllButDefault') {
        scope.reExportAll.push({source: req})
        continue
      }
      const exportName = e.exportName.name
      if (!exportName) continue
      if (req) {
        scope.exportsByName.set(exportName, {
          reExport: {source: req, imported: e.importName.name ?? exportName}
        })
      } else if (e.localName.name) {
        scope.exportsByName.set(exportName, {local: e.localName.name})
      }
    }
  }

  // ── Top-level declarations (one pass over program body) ──
  const body: any[] = parsed.program.body ?? []
  const record = (name: string, b: LocalBinding) => {
    if (!scope.decls.has(name)) scope.decls.set(name, b)
  }
  for (const raw of body) {
    let stmt = raw
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) stmt = stmt.declaration
    if (stmt.type === 'ExportDefaultDeclaration') {
      const d = stmt.declaration
      if (d?.type === 'FunctionDeclaration' && d.id?.name) {
        record(d.id.name, {kind: 'local', what: 'function', node: d})
        scope.defaultExportLocal = d.id.name
      } else if (d?.type === 'Identifier') {
        scope.defaultExportLocal = d.name
      } else if (d) {
        // `export default memo(Row)`, an arrow, a class, etc. — keep the node so
        // the module graph can unwrap it (HOC / direct fn).
        scope.defaultExportNode = d
      }
      continue
    }
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
      record(stmt.id.name, {kind: 'local', what: 'function', node: stmt})
    } else if (stmt.type === 'ClassDeclaration' && stmt.id?.name) {
      record(stmt.id.name, {kind: 'local', what: 'function', node: stmt})
    } else if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (decl.id?.type !== 'Identifier') continue
        const init = decl.init
        const what = init && isFn(init) ? 'function' : 'var'
        record(decl.id.name, {kind: 'local', what, node: decl, init})
      }
    }
  }

  return scope
}
