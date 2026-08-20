import type {Plugin as RolldownPlugin} from 'rolldown'
import type {Plugin as VitePlugin} from 'rolldown-vite'
import * as fs from 'fs'
import {buildSchema, GraphQLSchema} from 'graphql'
import path from 'path'
import {Node, SyntaxKind} from 'ts-morph'
import {
  clearAnalyzeCache,
  extractAdvancedSelectors,
  extractAdvancedSelectorsForSourceFile,
  extractQueries,
  type QueryLocation,
  type SelectorNode
} from './analyze'
import {StaticAnalysisManager} from './manager'
import {lowerMutation, lowerQuery} from './selectors-to-document'
import {generatePrepare} from './selectors-to-prepare'

const DOC_IMPORT = `import { doc as __pylonDoc } from '@getcronit/pylon/query';\n`

const ARG_RESERVED = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'typeof', 'void', 'in', 'of',
  'instanceof', 'new', 'await', 'async', 'function', 'return'
])

/** Identifiers referenced inside a selector tree's copied `__args` expressions. */
function collectArgIdentifiers(selectors: any, into: Set<string>): void {
  for (const [key, value] of Object.entries(selectors)) {
    if (key === '__args') {
      for (const m of String(value).match(/[A-Za-z_$][\w$]*/g) ?? []) {
        if (!ARG_RESERVED.has(m)) into.add(m)
      }
      continue
    }
    if (key === '__isList') continue
    for (const branch of Array.isArray(value) ? value : [value]) {
      if (branch && typeof branch === 'object') collectArgIdentifiers(branch, into)
    }
  }
}

const isFnLike = (n: Node): boolean =>
  Node.isFunctionDeclaration(n) ||
  Node.isArrowFunction(n) ||
  Node.isFunctionExpression(n) ||
  Node.isMethodDeclaration(n)

/**
 * Variables a query's generated `prepare` reads that are declared AFTER the
 * `useData()` call in the SAME component function. `useData` runs `prepare`
 * synchronously, so those are in their temporal dead zone → "Cannot access … before
 * initialization" at runtime. Names already bound before the call (parameters or
 * earlier declarations) shadow any later same-name declaration, so they're safe and
 * excluded — keeping this from false-positiving on legitimate code.
 */
function findPrepareTDZ(query: {
  node: any
  selectors: any
}): {name: string; line: number}[] {
  const names = new Set<string>()
  collectArgIdentifiers(query.selectors, names)
  if (names.size === 0) return []

  const call = query.node
  const fn = call.getFirstAncestor(isFnLike)
  if (!fn) return []
  const callStart = call.getStart()

  const boundBefore = new Set<string>()
  for (const p of fn.getParameters()) {
    for (const id of p.getDescendantsOfKind(SyntaxKind.Identifier)) {
      boundBefore.add(id.getText())
    }
  }
  const afterDecls = new Map<string, number>()
  for (const decl of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (decl.getFirstAncestor(isFnLike) !== fn) continue // only this function's scope
    const nameNode = decl.getNameNode()
    if (!Node.isIdentifier(nameNode)) continue // skip destructuring (conservative)
    const name = nameNode.getText()
    if (decl.getStart() < callStart) boundBefore.add(name)
    else if (!afterDecls.has(name)) afterDecls.set(name, decl.getStartLineNumber())
  }

  const out: {name: string; line: number}[] = []
  for (const name of names) {
    if (afterDecls.has(name) && !boundBefore.has(name)) {
      out.push({name, line: afterDecls.get(name)!})
    }
  }
  return out
}

/** Infer the connection root path for a paginated query (single top-level field). */
function inferConnectionPath(
  selectors: any
): {path: string[]} | undefined {
  const keys = Object.keys(selectors).filter(
    k => k !== '__args' && k !== '__isList'
  )
  if (keys.length === 0) return undefined
  return {path: [keys[0]]}
}

/** Make a string safe as both a JS identifier and a GraphQL operation name. */
function sanitizeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1')
}

/**
 * Mutation field from `useMutation('createUser')` (the string key, primary form)
 * or the legacy `useMutation(m => m.createUser)` selector.
 */
function extractMutationField(arg: Node | undefined): string | null {
  if (!arg) return null
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.getLiteralText()
  }
  if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
    let body: Node | undefined = arg.getBody()
    if (Node.isBlock(body)) {
      const ret = body.getStatements().find(Node.isReturnStatement)
      body = ret?.getExpression()
    }
    if (body && Node.isPropertyAccessExpression(body)) return body.getName()
  }
  return null
}

/** The trigger binding name from `const [trigger, state] = useMutation(...)`. */
function extractTriggerName(callNode: Node): string | null {
  const varDecl = callNode.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
  if (!varDecl) return null
  const nameNode = varDecl.getNameNode()
  if (Node.isArrayBindingPattern(nameNode)) {
    const first = nameNode.getElements()[0]
    if (first && Node.isBindingElement(first)) {
      const n = first.getNameNode()
      if (Node.isIdentifier(n)) return n.getText()
    }
  }
  return null
}

/** Find `useMutation(...)` calls, the field each selects, and the trigger name. */
function findMutationCalls(
  sourceFile: any,
  pylonPackage: string,
  hookName: string
): {node: Node; field: string | null; trigger: string | null}[] {
  const aliases = new Set<string>()
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== pylonPackage) continue
    for (const named of imp.getNamedImports()) {
      if (named.getName() === hookName) {
        aliases.add(named.getAliasNode()?.getText() ?? named.getName())
      }
    }
  }
  if (aliases.size === 0) return []

  const out: {node: Node; field: string | null; trigger: string | null}[] = []
  sourceFile.forEachDescendant((node: Node) => {
    if (!Node.isCallExpression(node)) return
    const expr = node.getExpression()
    if (!Node.isIdentifier(expr) || !aliases.has(expr.getText())) return
    out.push({
      node,
      field: extractMutationField(node.getArguments()[0]),
      trigger: extractTriggerName(node)
    })
  })
  return out
}

/**
 * Parse a connection chain selector `q => q.post({ id }).comments` into the path
 * to the connection + the call args on intermediate fields. The terminal
 * connection is left UNCALLED (its args come from usePaginatedData's 2nd arg).
 */
function parseChainSelector(
  arg: Node | undefined
): {path: string[]; args: Record<string, string>} | null {
  if (!arg || !(Node.isArrowFunction(arg) || Node.isFunctionExpression(arg))) {
    return null
  }
  let body: Node | undefined = arg.getBody()
  if (Node.isBlock(body)) {
    body = body.getStatements().find(Node.isReturnStatement)?.getExpression()
  }
  if (!body) return null

  const path: string[] = []
  const args: Record<string, string> = {}
  const walk = (expr: Node): boolean => {
    if (Node.isIdentifier(expr)) return true // the arrow param `q`
    if (Node.isParenthesizedExpression(expr)) return walk(expr.getExpression())
    if (Node.isPropertyAccessExpression(expr)) {
      if (!walk(expr.getExpression())) return false
      path.push(expr.getName())
      return true
    }
    if (Node.isCallExpression(expr)) {
      const callee = expr.getExpression()
      if (!Node.isPropertyAccessExpression(callee)) return false
      if (!walk(callee.getExpression())) return false
      const name = callee.getName()
      path.push(name)
      const a = expr.getArguments()[0]
      if (a) args[name] = a.getText()
      return true
    }
    return false
  }
  if (!walk(body) || path.length === 0) return null
  return {path, args}
}

/** The result binding from `const comments = usePaginatedData(...)`. */
function extractResultVar(callNode: Node): string | null {
  const varDecl = callNode.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
  if (!varDecl) return null
  const nameNode = varDecl.getNameNode()
  return Node.isIdentifier(nameNode) ? nameNode.getText() : null
}

/** Find `usePaginatedData(...)` calls + their connection path + result binding. */
function findPaginatedCalls(
  sourceFile: any,
  pylonPackage: string,
  hookName: string
): {node: Node; path: string[]; args: Record<string, string>; resultVar: string | null}[] {
  const aliases = new Set<string>()
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== pylonPackage) continue
    for (const named of imp.getNamedImports()) {
      if (named.getName() === hookName) {
        aliases.add(named.getAliasNode()?.getText() ?? named.getName())
      }
    }
  }
  if (aliases.size === 0) return []

  const out: {node: Node; path: string[]; args: Record<string, string>; resultVar: string | null}[] = []
  sourceFile.forEachDescendant((node: Node) => {
    if (!Node.isCallExpression(node)) return
    const expr = node.getExpression()
    if (!Node.isIdentifier(expr) || !aliases.has(expr.getText())) return
    const chain = parseChainSelector(node.getArguments()[0])
    out.push({
      node,
      path: chain?.path ?? [],
      args: chain?.args ?? {},
      resultVar: extractResultVar(node)
    })
  })
  return out
}

/** Build the nested selector tree from a connection path + intermediate args + node selection. */
function buildConnectionTree(
  path: string[],
  args: Record<string, string>,
  resultSelectors: SelectorNode
): SelectorNode {
  const tree: SelectorNode = {}
  let cur: SelectorNode = tree
  path.forEach((field, i) => {
    const node: SelectorNode = {}
    if (args[field]) node.__args = args[field]
    if (i === path.length - 1) Object.assign(node, resultSelectors)
    cur[field] = node
    cur = node
  })
  return tree
}

/**
 * Rewrite `usePaginatedData(q => …, userArgs?)` → `usePaginatedData(doc, thunk,
 * userArgs?)` — replace the selector with the document, keep the user args.
 */
function rewritePaginatedCall(
  source: string,
  node: any,
  constName: string,
  thunk: string | undefined
): string {
  const open = node.getFirstChildByKind(SyntaxKind.OpenParenToken)
  const close = node.getLastChildByKind(SyntaxKind.CloseParenToken)
  if (!open || !close) return source
  const rest = node
    .getArguments()
    .slice(1)
    .map((a: Node) => source.slice(a.getStart(), a.getEnd()))
    .join(', ')
  let inner: string
  if (thunk && rest) inner = `${constName}, ${thunk}, ${rest}`
  else if (thunk) inner = `${constName}, ${thunk}`
  else if (rest) inner = `${constName}, undefined, ${rest}`
  else inner = constName
  return source.slice(0, open.getEnd()) + inner + source.slice(close.getStart())
}

/** Find `op.query(cb)` / `op.mutation(cb)` calls (op imported from pylonPackage). */
function findOperationCalls(
  sourceFile: any,
  pylonPackage: string
): {node: Node; opType: 'query' | 'mutation'; callback: Node | undefined}[] {
  const aliases = new Set<string>()
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== pylonPackage) continue
    for (const named of imp.getNamedImports()) {
      if (named.getName() === 'op') {
        aliases.add(named.getAliasNode()?.getText() ?? named.getName())
      }
    }
  }
  if (aliases.size === 0) return []

  const out: {node: Node; opType: 'query' | 'mutation'; callback: Node | undefined}[] = []
  sourceFile.forEachDescendant((node: Node) => {
    if (!Node.isCallExpression(node)) return
    const expr = node.getExpression()
    if (!Node.isPropertyAccessExpression(expr)) return
    const obj = expr.getExpression()
    if (!Node.isIdentifier(obj) || !aliases.has(obj.getText())) return
    const method = expr.getName()
    if (method !== 'query' && method !== 'mutation') return
    out.push({node, opType: method, callback: node.getArguments()[0]})
  })
  return out
}

/** Analyze an `op.query`/`op.mutation` callback's field access on its root param. */
function analyzeOperationCallback(
  callback: Node | undefined
): SelectorNode | null {
  if (
    !callback ||
    !(Node.isArrowFunction(callback) || Node.isFunctionExpression(callback))
  ) {
    return null
  }
  const param = callback.getParameters()[0]
  if (!param) return null
  const nameNode = param.getNameNode()
  if (!Node.isIdentifier(nameNode)) return null // destructured param: unsupported v1
  // Analyze accesses on the callback's root param within its body — the same
  // selector extraction useData runs on `data`.
  return extractAdvancedSelectors(callback.getBody().getText(), nameNode.getText())
}

/** Rewrite `op.query(cb)` → `op.query(doc, thunk, cb)` — keep cb for projection. */
function rewriteOperationCall(
  source: string,
  node: any,
  constName: string,
  thunk: string | undefined
): string {
  const open = node.getFirstChildByKind(SyntaxKind.OpenParenToken)
  const close = node.getLastChildByKind(SyntaxKind.CloseParenToken)
  const cb = node.getArguments()[0]
  if (!open || !close || !cb) return source
  const cbText = source.slice(cb.getStart(), cb.getEnd())
  const inner = `${constName}, ${thunk ?? 'undefined'}, ${cbText}`
  return source.slice(0, open.getEnd()) + inner + source.slice(close.getStart())
}

/** Recursively drop `__args` — nested mutation-result fields can't take runtime args. */
function stripArgs(node: SelectorNode): SelectorNode {
  const out: SelectorNode = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === '__args') continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = stripArgs(value as SelectorNode)
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * The `analyze(triggerReturn)` part of the mutation selection: trace how the
 * trigger's awaited result is read across the component, so nested/relation reads
 * (`const u = await createUser(...); u.posts[].title`) join the document.
 * allScalars already covers scalar reads, so this adds object relations.
 */
function analyzeTriggerReturn(
  useMutationCall: Node,
  triggerName: string,
  fileText: string
): SelectorNode {
  const fn = useMutationCall.getFirstAncestor(isFnLike)
  if (!fn) return {}

  let merged: SelectorNode = {}
  fn.forEachDescendant((node: Node) => {
    if (!Node.isCallExpression(node)) return
    const callee = node.getExpression()
    if (!Node.isIdentifier(callee) || callee.getText() !== triggerName) return

    let p: Node | undefined = node.getParent()
    if (p && Node.isAwaitExpression(p)) p = p.getParent()
    if (p && Node.isParenthesizedExpression(p)) p = p.getParent()
    if (!p) return

    if (Node.isVariableDeclaration(p)) {
      const nameNode = p.getNameNode()
      if (Node.isIdentifier(nameNode)) {
        // const u = await trigger(...) → analyze accesses on `u`, scoped to the
        // enclosing function body. Sibling handlers commonly reuse the same
        // result name (e.g. several `const res = await otherTrigger()`); tracing
        // the bare name across the whole file would merge THEIR field reads into
        // this mutation's selection and flag fields the payload doesn't have.
        const scopeFn = p.getFirstAncestor(isFnLike)
        const scopeBody = (scopeFn as any)?.getBody?.() as Node | undefined
        const scopeText =
          scopeBody && Node.isBlock(scopeBody) ? scopeBody.getText() : fileText
        merged = deepMergeSelectors(
          merged,
          stripArgs(extractAdvancedSelectors(scopeText, nameNode.getText()))
        )
      } else if (Node.isObjectBindingPattern(nameNode)) {
        // const { posts } = await trigger(...) → shallow field set.
        for (const el of nameNode.getElements()) {
          const name = el.getPropertyNameNode()?.getText() ?? el.getName()
          if (name && !(name in merged)) merged[name] = true
        }
      }
    } else if (Node.isPropertyAccessExpression(p)) {
      // (await trigger(...)).field
      const name = p.getName()
      if (name && !(name in merged)) merged[name] = true
    }
  })
  return stripAnalyzerArtifacts(merged)
}

/**
 * Drop analyzer-internal placeholder keys from a mutation's trigger-return
 * selection. `extractAdvancedSelectors` traces the result variable across the
 * whole file and can leak markers that aren't real fields — `__state` /
 * `__index_*` (the `useState` tuple model), `__literal_*` (a literal in
 * selection position), `__prop_*`, etc. A mutation result field is always a real
 * GraphQL name; the only `__`-prefixed field that is selectable is `__typename`.
 */
function stripAnalyzerArtifacts(sel: SelectorNode): SelectorNode {
  const out: SelectorNode = {}
  for (const [key, val] of Object.entries(sel)) {
    if (key.startsWith('__') && key !== '__typename') continue
    out[key] =
      val && typeof val === 'object' && !Array.isArray(val)
        ? stripAnalyzerArtifacts(val as SelectorNode)
        : val
  }
  return out
}

function deepMergeSelectors(a: SelectorNode, b: SelectorNode): SelectorNode {
  const out: SelectorNode = {...a}
  for (const [key, bv] of Object.entries(b)) {
    const av = out[key]
    if (
      av &&
      bv &&
      typeof av === 'object' &&
      typeof bv === 'object' &&
      !Array.isArray(av) &&
      !Array.isArray(bv)
    ) {
      out[key] = deepMergeSelectors(av as SelectorNode, bv as SelectorNode)
    } else if (av === undefined || av === true) {
      out[key] = bv
    }
  }
  return out
}

/**
 * Rewrite `useMutation(m => m.field[, options])` → `useMutation(doc[, options])`,
 * replacing the selector with the compiled document and preserving options.
 */
function rewriteMutationCall(
  source: string,
  node: any,
  constName: string
): string {
  const open = node.getFirstChildByKind(SyntaxKind.OpenParenToken)
  const close = node.getLastChildByKind(SyntaxKind.CloseParenToken)
  if (!open || !close) return source
  const innerStart = open.getEnd()
  const innerEnd = close.getStart()
  const rest = node
    .getArguments()
    .slice(1)
    .map((a: Node) => source.slice(a.getStart(), a.getEnd()))
    .join(', ')
  const inner = rest ? `${constName}, ${rest}` : constName
  return source.slice(0, innerStart) + inner + source.slice(innerEnd)
}

/**
 * Rewrite a `useData(...)` / `usePaginatedData(...)` call's arguments to
 * `(doc[, thunk][, origOptions])`. Existing options (e.g. `{tags}`) move to the
 * 3rd slot; `undefined` fills the thunk slot when the op has no variables.
 */
function rewriteCall(
  source: string,
  node: any,
  constName: string,
  thunk?: string
): string {
  const open = node.getFirstChildByKind(SyntaxKind.OpenParenToken)
  const close = node.getLastChildByKind(SyntaxKind.CloseParenToken)
  if (!open || !close) return source
  const innerStart = open.getEnd()
  const innerEnd = close.getStart()
  const orig = source.slice(innerStart, innerEnd).trim()
  let inner: string
  if (orig) {
    inner = thunk
      ? `${constName}, ${thunk}, ${orig}`
      : `${constName}, undefined, ${orig}`
  } else {
    inner = thunk ? `${constName}, ${thunk}` : constName
  }
  return source.slice(0, innerStart) + inner + source.slice(innerEnd)
}

export interface UseDataStaticAnalyzerOptions {
  /**
   * Emit `@inContext(locale: $__locale)` on every compiled operation, so resolvers can read
   * the locale via `getLocale()`. Set by the pages build when `usePages({i18n})` is
   * configured; without it nothing about i18n appears in the documents.
   */
  inContext?: boolean
  filter?: RegExp
  pylonPackage?: string
  hookName?: string
  debug?: boolean
  manager?: StaticAnalysisManager
  /**
   * When provided, the analyzer compiles each useData selection into a real
   * GraphQL document (the pylon-query path) instead of injecting a gqty
   * `prepare` closure. The production pages build always provides one (read from
   * `.pylon/schema.graphql`). Standalone unit tests omit it and keep the legacy
   * prepare injection.
   */
  schema?: GraphQLSchema
  /** Path to the SDL to load a schema from, if `schema` isn't passed directly. */
  schemaPath?: string
  /** Hook to analyze as a Relay connection (e.g. "usePaginatedData"). */
  paginatedHookName?: string
  /** Mutation hook to analyze (e.g. "useMutation"). */
  mutationHookName?: string
  /** GraphQL scalar name → TS type, forwarded to the document compiler. */
  scalarTypes?: Record<string, string>
}

/**
 * Bundler-agnostic core of the useData static analyzer. Holds the ts-morph project +
 * schema + manager and exposes `start()` / `addEntries()` / `transform()`. Wrapped by
 * a thin esbuild adapter (below) and a rolldown adapter (in the page build) so the
 * same analysis logic backs both bundlers. `transform` returns an esbuild-onLoad-shaped
 * result ({contents, loader, watchFiles, warnings} | null); adapters map as needed.
 */
export function createUseDataAnalyzerCore(
  options: UseDataStaticAnalyzerOptions & {tsConfigFilePath?: string} = {}
) {
  const {
    filter = /\.(ts|tsx)$/,
    pylonPackage = '@getcronit/pylon/pages',
    hookName = 'useData',
    paginatedHookName = 'usePaginatedData',
    mutationHookName = 'useMutation',
    debug = false
  } = options

  const loadSchema = (): GraphQLSchema | undefined => {
    if (options.schema) return options.schema
    const sdlPath =
      options.schemaPath ?? path.join(process.cwd(), '.pylon/schema.graphql')
    try {
      return buildSchema(fs.readFileSync(sdlPath, 'utf8'))
    } catch {
      return undefined
    }
  }

  // Resolve the schema once per build session (re-read on each `start()` so
  // dev-loop schema changes are picked up).
  let schema: GraphQLSchema | undefined = loadSchema()
  const manager =
    options.manager ||
    new StaticAnalysisManager({tsConfigFilePath: options.tsConfigFilePath})
  const project = manager.getProject()

  const start = () => {
    manager.resetSession()
    clearAnalyzeCache() // Flushes internal analyze memoization
    schema = loadSchema()
  }

  const addEntries = (entryPaths: string[]) => {
    if (entryPaths.length > 0) {
      project.addSourceFilesAtPaths(entryPaths)
      // The TS compiler will only parse when asked now.
      project.resolveSourceFileDependencies()
    }
  }

  const transform = async (args: {path: string}, contents: string) => {

        const cached = manager.getCachedResult(args.path, contents)
        if (cached) {
          return {
            contents: cached.contents,
            loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
            watchFiles: cached.dependencies
          }
        }

        // ESBuild pre-flight check bypasses ts-morph parse overhead entirely
        if (
          !contents.includes(pylonPackage) ||
          (!contents.includes(hookName) && !contents.includes('from'))
        ) {
          manager.setCache(args.path, {
            contents,
            dependencies: [args.path],
            hash: (manager as any).computeHash(contents)
          })
          return null
        }

        manager.updateSourceFile(args.path, contents)

        // Eagerly load this file's imports (transitively) into the project so JSX
        // components imported from other files — including through `@/…`-style
        // tsconfig path aliases and the connection node's TYPE (`@/.pylon/client`) —
        // resolve during analysis. Without this, the connection pass runs with a thin
        // project (in prod the rolldown build feeds the WHOLE module graph through
        // `transform`, so every dep is already loaded; in dev each module is
        // transformed on-demand, so the project would otherwise hold only this file),
        // `coreAnalyze` can't trace a node-field read (`e.actorLabel` in a
        // `DataGridColumn<AuditEvent>` cell renderer) back to the connection node, and
        // the selection collapses to `{ id }`. We resolve via ts-morph's
        // `getModuleSpecifierSourceFile()` (which honors tsconfig `paths`, unlike a
        // `startsWith('.')` text check) and walk imports breadth-first, stopping at
        // `node_modules` to bound the cost to the app's own source.
        try {
          const rootSf = project.getSourceFile(args.path)
          if (rootSf) {
            const seen = new Set<string>([args.path])
            const queue = [rootSf]
            while (queue.length) {
              const sf = queue.shift()!
              for (const imp of sf.getImportDeclarations()) {
                const dep = imp.getModuleSpecifierSourceFile()
                if (!dep) continue
                const depPath = dep.getFilePath()
                if (seen.has(depPath)) continue
                seen.add(depPath)
                if (depPath.includes('/node_modules/')) continue
                queue.push(dep)
              }
            }
          }
        } catch {}

        if (debug) {
          console.log(`[Pylon] Analyzing ${args.path}`)
        }

        try {
          const {queries, dependencies} = extractQueries(args.path, project, {
            pylonPackage,
            hookName,
            skipDependencyResolution: true
          })

          let outputContents = contents
          const tdzWarnings: {
            text: string
            location: {file: string; line: number}
          }[] = []
          const buildErrors: {
            text: string
            location: {file: string; line: number}
          }[] = []

          // ── Document mode (production): compile selections to a real GraphQL
          // document + variables thunk. TDZ is handled structurally at runtime
          // (the wrapper evaluates the thunk lazily at first field access), so
          // there are no TDZ warnings here.
          if (schema) {
            const base = sanitizeName(
              path.basename(args.path).replace(/\.[^.]+$/, '')
            )

            type Item = {
              kind: 'query' | 'mutation' | 'paginated' | 'operation'
              node: any
              start: number
              selectors?: any
              connection?: {path: string[]}
              field?: string | null
              trigger?: string | null
              path?: string[]
              chainArgs?: Record<string, string>
              resultVar?: string | null
              opType?: 'query' | 'mutation'
              callback?: Node
              constName: string
              index: number
              decl?: string
            }
            const items: Item[] = []
            queries.forEach(q =>
              items.push({
                kind: 'query',
                node: q.node,
                start: q.start,
                selectors: q.selectors,
                constName: '',
                index: 0
              })
            )

            let allDeps = dependencies
            const sourceFileForCalls =
              contents.includes(paginatedHookName) ||
              contents.includes(mutationHookName) ||
              contents.includes('op.')
                ? project.getSourceFile(args.path)
                : undefined

            if (sourceFileForCalls && contents.includes(paginatedHookName)) {
              for (const p of findPaginatedCalls(
                sourceFileForCalls,
                pylonPackage,
                paginatedHookName
              )) {
                items.push({
                  kind: 'paginated',
                  node: p.node,
                  start: p.node.getStart(),
                  path: p.path,
                  chainArgs: p.args,
                  resultVar: p.resultVar,
                  constName: '',
                  index: 0
                })
              }
            }

            if (sourceFileForCalls && contents.includes(mutationHookName)) {
              const sf = sourceFileForCalls
              {
                for (const m of findMutationCalls(sf, pylonPackage, mutationHookName)) {
                  items.push({
                    kind: 'mutation',
                    node: m.node,
                    start: m.node.getStart(),
                    field: m.field,
                    trigger: m.trigger,
                    constName: '',
                    index: 0
                  })
                }
              }
            }

            // Imperative op.query / op.mutation calls (the `resolve` replacement).
            if (sourceFileForCalls && contents.includes('op.')) {
              for (const o of findOperationCalls(sourceFileForCalls, pylonPackage)) {
                items.push({
                  kind: 'operation',
                  node: o.node,
                  start: o.node.getStart(),
                  opType: o.opType,
                  callback: o.callback,
                  constName: '',
                  index: 0
                })
              }
            }

            if (items.length > 0) {
              // Stable numbering by source order.
              const ordered = [...items].sort((a, b) => a.start - b.start)
              ordered.forEach((it, i) => {
                it.index = i
                it.constName = `__pylonDoc_${base}_${i}`
              })

              // Apply call rewrites descending so positions stay valid.
              const desc = [...items].sort((a, b) => b.start - a.start)
              for (const it of desc) {
                try {
                  if (it.kind === 'mutation') {
                    if (!it.field) {
                      throw new Error(
                        'useMutation expects a `m => m.field` selector naming the mutation.'
                      )
                    }
                    const nested = it.trigger
                      ? analyzeTriggerReturn(it.node, it.trigger, contents)
                      : {}
                    const lowered = lowerMutation(
                      schema,
                      it.field,
                      `${base}_${it.index}`,
                      it.constName,
                      {
                        scalarTypes: options.scalarTypes,
                        docFnName: '__pylonDoc',
                        inContext: options.inContext,
                        nested
                      }
                    )
                    it.decl = lowered.docDeclaration
                    outputContents = rewriteMutationCall(
                      outputContents,
                      it.node,
                      it.constName
                    )
                  } else if (it.kind === 'paginated') {
                    if (!it.path || it.path.length === 0) {
                      throw new Error(
                        'usePaginatedData expects a connection selector, e.g. ' +
                          '`q => q.posts` or `q => q.post({ id }).comments`.'
                      )
                    }
                    // Node selection comes from how the RESULT is read
                    // (comments.nodes[].body); path + intermediate args from the
                    // selector chain.
                    // Trace the result var on the MAIN source file (not an
                    // in-memory text copy) so reads that cross into imported row
                    // components resolve and contribute node fields.
                    const resultSelectors = it.resultVar
                      ? extractAdvancedSelectorsForSourceFile(
                          sourceFileForCalls!,
                          it.resultVar
                        )
                      : {}
                    const tree = buildConnectionTree(
                      it.path,
                      it.chainArgs ?? {},
                      resultSelectors
                    )
                    const lowered = lowerQuery(
                      schema,
                      tree,
                      `${base}_${it.index}`,
                      it.constName,
                      {
                        scalarTypes: options.scalarTypes,
                        connection: {path: it.path},
                        docFnName: '__pylonDoc',
                        inContext: options.inContext
                      }
                    )
                    it.decl = lowered.docDeclaration
                    outputContents = rewritePaginatedCall(
                      outputContents,
                      it.node,
                      it.constName,
                      lowered.variablesThunk
                    )
                  } else if (it.kind === 'operation') {
                    const selectors = analyzeOperationCallback(it.callback)
                    if (!selectors) {
                      throw new Error(
                        `op.${it.opType} expects an inline \`q => …\` selector ` +
                          'with a single root param.'
                      )
                    }
                    const lowered = lowerQuery(
                      schema,
                      selectors,
                      `${base}_${it.index}`,
                      it.constName,
                      {
                        scalarTypes: options.scalarTypes,
                        operation: it.opType,
                        docFnName: '__pylonDoc',
                        inContext: options.inContext,
                        fillObjectLeaves: true
                      }
                    )
                    it.decl = lowered.docDeclaration
                    outputContents = rewriteOperationCall(
                      outputContents,
                      it.node,
                      it.constName,
                      lowered.variablesThunk
                    )
                  } else {
                    const lowered = lowerQuery(
                      schema,
                      it.selectors,
                      `${base}_${it.index}`,
                      it.constName,
                      {
                        scalarTypes: options.scalarTypes,
                        connection: it.connection,
                        docFnName: '__pylonDoc',
                        inContext: options.inContext
                      }
                    )
                    it.decl = lowered.docDeclaration
                    outputContents = rewriteCall(
                      outputContents,
                      it.node,
                      it.constName,
                      lowered.variablesThunk
                    )
                  }
                } catch (e: any) {
                  const label =
                    it.kind === 'mutation'
                      ? 'useMutation'
                      : it.kind === 'operation'
                        ? `op.${it.opType}`
                        : 'useData'
                  buildErrors.push({
                    text: `${label}(): ${e?.message ?? e}`,
                    location: {
                      file: args.path,
                      line: it.node.getStartLineNumber()
                    }
                  })
                }
              }

              // Import prepended + declarations appended in source order. Doing
              // this AFTER the rewrites keeps those slice positions original.
              const declarations = ordered
                .map(it => it.decl)
                .filter(Boolean)
                .join('\n\n')
              outputContents =
                DOC_IMPORT + outputContents + '\n\n' + declarations + '\n'
            }

            manager.setCache(args.path, {
              contents: outputContents,
              dependencies: allDeps,
              hash: (manager as any).computeHash(contents)
            })
            return {
              contents: outputContents,
              loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
              watchFiles: allDeps,
              errors: buildErrors.length ? buildErrors : undefined
            }
          }

          if (queries.length > 0) {
            // OPTIMIZATION: Sort descending so string slice replacements don't offset index paths
            const sortedQueries = [...queries].sort((a, b) => b.start - a.start)
            // Captured here because the loop shadows `args` with the call's arguments.
            const sourcePath = args.path

            for (const query of sortedQueries) {
              const node = query.node

              // `prepare` is ONLY a pre-fetch optimization — gqty re-registers the
              // same selections when the render reads `data.x`. If it would read a
              // variable declared AFTER this useData() call, injecting it would hit a
              // temporal dead zone at runtime. So SKIP injecting this one (the data
              // still loads lazily) and WARN — don't fail the build. Reorder useData
              // below the variable to restore the pre-fetch.
              const tdz = findPrepareTDZ(query)
              if (tdz.length > 0) {
                const vars = tdz
                  .map(v => `\`${v.name}\` (line ${v.line})`)
                  .join(', ')
                tdzWarnings.push({
                  text:
                    `useData() build-time pre-fetch skipped: a data selection reads ` +
                    `${vars} — declared AFTER this useData() call (temporal dead zone). ` +
                    `Data still loads lazily; move this useData() call below ` +
                    `${tdz.length > 1 ? 'those variables' : 'that variable'} to restore pre-fetch.`,
                  location: {file: sourcePath, line: node.getStartLineNumber()}
                })
                continue
              }

              const args = node.getArguments()
              const prepareFn = generatePrepare(query.selectors)

              if (args.length === 0) {
                // Find closing parenthesis character position
                const closeParen = node.getLastChildByKind(
                  SyntaxKind.CloseParenToken
                )
                const pos = closeParen
                  ? closeParen.getStart()
                  : node.getEnd() - 1

                outputContents =
                  outputContents.slice(0, pos) +
                  `{\n  prepare: ${prepareFn}\n}` +
                  outputContents.slice(pos)
              } else {
                const firstArg = args[0]
                if (Node.isObjectLiteralExpression(firstArg)) {
                  // Direct injection at the start of the object
                  const startPos = firstArg.getStart() + 1
                  const text = firstArg.getText()
                  const isEmpty = text.replace(/\s/g, '') === '{}'

                  // If the object has existing properties (e.g., \n  foo: "bar"),
                  // we inject our property followed by a comma. The existing newline
                  // and indentation from the next property will naturally flow after it!
                  const injection = isEmpty
                    ? `\n  prepare: ${prepareFn}\n`
                    : `\n  prepare: ${prepareFn},`

                  outputContents =
                    outputContents.slice(0, startPos) +
                    injection +
                    outputContents.slice(startPos)
                } else {
                  // Argument wrapping
                  const startPos = firstArg.getStart()
                  const endPos = firstArg.getEnd()
                  const existingText = outputContents.slice(startPos, endPos)

                  outputContents =
                    outputContents.slice(0, startPos) +
                    `{\n  ...${existingText},\n  prepare: ${prepareFn}\n}` +
                    outputContents.slice(endPos)
                }
              }
            }

            if (debug) {
              console.log(
                `[Pylon] Effectively injected selectors into ${queries.length} calls in ${args.path}`
              )
            }
          }

          manager.setCache(args.path, {
            contents: outputContents,
            dependencies,
            hash: (manager as any).computeHash(contents)
          })

          const loader = args.path.endsWith('.tsx') ? 'tsx' : 'ts'
          return {
            contents: outputContents,
            loader,
            watchFiles: dependencies,
            warnings: tdzWarnings.length ? tdzWarnings : undefined
          }
        } catch (err) {
          console.error(`[Pylon] Error analyzing ${args.path}:`, err)
          return null
        }
  }

  return {filter, manager, project, start, addEntries, transform}
}

/**
 * rolldown adapter — thin wrapper over the same bundler-agnostic core. rolldown
 * reads the file for us and hands the source to the `transform` hook, so unlike
 * the esbuild adapter there's no manual readFile. The core's transformed output
 * is (possibly rewritten) TS/TSX, so we tag `moduleType` to have oxc re-parse it.
 */
export function useDataStaticAnalyzerRolldown(
  options: UseDataStaticAnalyzerOptions & {
    tsConfigFilePath?: string
    entryPaths?: string[]
  } = {}
): RolldownPlugin {
  const core = createUseDataAnalyzerCore(options)
  return {
    name: 'pylon-use-data-static-analyzer',
    buildStart() {
      core.start()
      if (options.entryPaths?.length) core.addEntries(options.entryPaths)
    },
    transform: {
      filter: {id: core.filter},
      async handler(code, id) {
        const result = await core.transform({path: id}, code)
        if (!result) return null
        if (result.errors?.length) {
          this.error(result.errors[0].text ?? 'useData analysis failed')
        }
        for (const w of result.warnings ?? []) {
          this.warn(w.text ?? String(w))
        }
        return {
          code: result.contents,
          moduleType: id.endsWith('.tsx') ? 'tsx' : 'ts',
          map: null
        }
      }
    }
  }
}

/**
 * Vite adapter — the SAME bundler-agnostic core, wrapped as a Vite plugin for the
 * dev engine (rfcs/DEV_SERVER.md Step 3). Vite's plugin API is a Rollup superset, so
 * this is nearly identical to the rolldown adapter with two Vite-specific details:
 *   - `enforce: 'pre'` so the analyzer rewrites the RAW `.ts`/`.tsx` source BEFORE
 *     Vite's built-in oxc TS→JS transform runs (it must see un-transpiled source to
 *     find + lower the `useData`/`useMutation`/`op.*` call sites);
 *   - `id` can carry a query suffix (`?t=`, `?v=`, `?import`) in dev — strip it before
 *     handing the path to the content-keyed core, and skip virtual/non-file ids.
 * The output is (possibly rewritten) TS/TSX; Vite's own transform then transpiles it.
 */
export function useDataStaticAnalyzerVite(
  options: UseDataStaticAnalyzerOptions & {
    tsConfigFilePath?: string
    entryPaths?: string[]
  } = {}
): VitePlugin {
  const core = createUseDataAnalyzerCore(options)
  return {
    name: 'pylon-use-data-static-analyzer',
    enforce: 'pre',
    buildStart() {
      core.start()
      if (options.entryPaths?.length) core.addEntries(options.entryPaths)
    },
    async transform(code, id) {
      // Vite appends query suffixes and uses `\0`-prefixed virtual ids — only real
      // `.ts`/`.tsx` files on disk are analyzable.
      if (id.startsWith('\0')) return null
      const filePath = id.split('?')[0]
      if (!core.filter.test(filePath)) return null

      const result = await core.transform({path: filePath}, code)
      if (!result) return null
      if (result.errors?.length) {
        this.error(result.errors[0].text ?? 'useData analysis failed')
      }
      for (const w of result.warnings ?? []) {
        this.warn(w.text ?? String(w))
      }
      return {code: result.contents, map: null}
    }
  }
}
