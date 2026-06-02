import * as crypto from 'crypto'
import {
  ArrowFunction,
  BindingPattern,
  FunctionDeclaration,
  FunctionExpression,
  MethodDeclaration,
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  ts
} from 'ts-morph'

export type SelectorNode = {
  [key: string]: SelectorNode | SelectorNode[] | boolean | string | undefined
  __args?: string
  __isList?: boolean
}

type PathSegment = {name: string; args?: string; isElement?: boolean}
type Path = PathSegment[]

/** Fast canonical key for a Path – used for O(1) deduplication. */
function pathKey(p: Path): string {
  let key = ''
  for (let i = 0; i < p.length; i++) {
    if (i > 0) key += '.'
    key += p[i].name
    if (p[i].args !== undefined) key += '(' + p[i].args + ')'
  }
  return key
}

/** Fast check: does `node` have any keys other than __isList / __args? */
function hasNonMetaKeys(node: any): boolean {
  for (const k in node) {
    if (k !== '__isList' && k !== '__args') return true
  }
  return false
}

// ── Module-level constant lookup tables (avoid reconstruction per coreAnalyze call) ──

const JS_ARRAY_ONLY_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'join',
  'flat',
  'flatMap',
  'reverse',
  'sort',
  'toReversed',
  'toSorted',
  'toSpliced'
])
const JS_SHARED_METHODS = new Set(['slice', 'concat', 'indexOf', 'includes'])
const JS_ARRAY_METHODS = new Set([
  ...JS_ARRAY_ONLY_METHODS,
  ...JS_SHARED_METHODS
])
const JS_INTERNALS = new Set([
  ...JS_ARRAY_METHODS,
  'length',
  'toString',
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toJSON',
  'valueOf',
  'hasOwnProperty',
  'trim',
  'trimStart',
  'trimEnd',
  'toLowerCase',
  'toUpperCase',
  'split',
  'substring',
  'substr',
  'replace',
  'replaceAll',
  'match',
  'matchAll',
  'startsWith',
  'endsWith',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'repeat',
  'padStart',
  'padEnd',
  'toFixed',
  'toPrecision',
  'toExponential',
  'bind',
  'call',
  'apply'
])
const ITERATOR_METHODS = new Set([
  'map',
  'filter',
  'forEach',
  'reduce',
  'some',
  'every',
  'find',
  'findIndex',
  'reverse',
  'sort',
  'slice',
  'concat',
  'flat',
  'flatMap',
  'toReversed',
  'toSorted',
  'toSpliced'
])

export interface QueryLocation {
  start: number
  end: number
  selectors: SelectorNode
  node: any // The CallExpression node
}

interface AnalyzeOptions {
  rootObjectName?: string
  targetNodes?: Node[]
  onFileAccess?: (sourceFile: SourceFile) => void
}

function coreAnalyze(sourceFile: SourceFile, options: AnalyzeOptions) {
  const result: Record<string, SelectorNode> = {}

  // OPTIMIZATION: Strictly lazy TypeChecker. Only spins up the TS Compiler if absolutely necessary.
  let _checker: any = undefined
  const getChecker = () => {
    if (!_checker) _checker = sourceFile.getProject().getTypeChecker()
    return _checker
  }

  // ── Memoized symbol / type lookups (Opt 4) ──
  const symbolCache = new WeakMap<Node, any>()
  function getSymbol(node: Node): any {
    let sym = symbolCache.get(node)
    if (sym !== undefined) return sym
    sym = (node as any).getSymbol?.() || getChecker().getSymbolAtLocation(node)
    symbolCache.set(node, sym ?? null)
    return sym ?? undefined
  }
  const typeCache = new WeakMap<Node, any>()
  function getNodeType(node: Node): any {
    let t = typeCache.get(node)
    if (t !== undefined) return t
    t = (node as any).getType()
    typeCache.set(node, t)
    return t
  }

  // ── Opt B: Deferred TypeChecker — avoid expensive calls for local identifiers ──
  let importedIdentifiers: Set<string> | undefined
  const getImportedIdentifiers = () => {
    if (importedIdentifiers) return importedIdentifiers
    importedIdentifiers = new Set<string>()
    sourceFile.getImportDeclarations().forEach(imp => {
      const namedBindings = imp.getImportClause()?.getNamedBindings()
      if (namedBindings && Node.isNamedImports(namedBindings)) {
        namedBindings.getElements().forEach(el => {
          importedIdentifiers!.add(el.getAliasNode()?.getText() || el.getName())
        })
      }
      const namespaceImport = imp.getImportClause()?.getNamespaceImport()
      if (namespaceImport) {
        importedIdentifiers!.add(namespaceImport.getText())
      }
    })
    return importedIdentifiers
  }

  const WELL_KNOWN_GLOBALS = new Set([
    'console',
    'Math',
    'JSON',
    'Array',
    'Object',
    'Promise',
    'Error',
    'Map',
    'Set',
    'Number',
    'String',
    'Boolean',
    'Date',
    'RegExp',
    'Intl',
    'Uint8Array',
    'Buffer',
    'React',
    'document',
    'window'
  ])

  function needsTypeChecker(node: Node): boolean {
    if (!Node.isIdentifier(node)) return true
    const name = node.getText()
    if (WELL_KNOWN_GLOBALS.has(name)) return false
    if (functionRegistry.has(name)) return false

    const paths = resolveBinding(name)
    if (paths.length === 0) return true
    return false
  }

  const trackedNames = new Set<string>()
  if (options.rootObjectName) {
    trackedNames.add(options.rootObjectName)
  }

  /**
   * OPTIMIZED: textMentionsTracked
   * Avoids expensive `node.getText()` allocations. Drops into native TS AST
   * to do a lightning-fast scan for matching identifier tokens.
   */
  function textMentionsTracked(node: Node): boolean {
    if (trackedNames.size === 0) return true
    let found = false
    const walkNative = (n: ts.Node) => {
      if (found) return
      if (ts.isIdentifier(n) && trackedNames.has(n.text)) {
        found = true
        return
      }
      ts.forEachChild(n, walkNative)
    }
    walkNative(node.compilerNode)
    return found
  }

  function mergePathAndArgs(
    tree: Record<string, SelectorNode>,
    path: Path,
    isList: boolean = false
  ) {
    if (path.length === 0) return
    if (path.some(p => p.name === '__decl')) return
    let current: any = tree

    for (let i = 0; i < path.length; i++) {
      const step = path[i]
      const key = step.name
      if (key === '__element') continue

      const args = step.args
      const isLast = i === path.length - 1
      const segmentIsList =
        (!!(step as any).__isList || (isLast && isList)) &&
        !(step as any).__isVirtual

      if (current[key] === true && !isLast) {
        current[key] = {}
      }

      let node = current[key]

      if (node === undefined || node === true) {
        if (args !== undefined) {
          node = {__args: args}
          current[key] = node
        } else {
          if (isLast && !segmentIsList) {
            current[key] = true
            node = true
          } else {
            node = {}
            current[key] = node
          }
        }
      }

      if (node === true) {
        if (isLast && !segmentIsList && args === undefined) return
        node = {}
        current[key] = node
      }

      if (Array.isArray(node)) {
        let branch = node.find((n: any) => n.__args === args)
        if (!branch) {
          branch = args !== undefined ? {__args: args} : {}
          node.push(branch)
        }
        node = branch
      } else if (
        args !== undefined &&
        node.__args !== undefined &&
        node.__args !== args
      ) {
        const oldNode = node
        const newNode = {__args: args}
        current[key] = [oldNode, newNode]
        node = newNode
      } else if (args === undefined && node.__args !== undefined) {
        const oldNode = node
        const newNode = {}
        current[key] = [oldNode, newNode]
        node = newNode
      } else if (args !== undefined && node.__args === undefined) {
        node.__args = args
      }

      if (segmentIsList) {
        if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
          node.__isList = true
        } else if (node === true) {
          current[key] = {__isList: true}
          node = current[key]
        }
      }

      if (!isLast) {
        current = node
      }
    }
  }

  function stringifyArgument(node: Node): string {
    if (Node.isObjectLiteralExpression(node)) {
      const props = node.getProperties().map((prop: any) => {
        if (Node.isPropertyAssignment(prop)) {
          const keyNode = prop.getNameNode()
          const key = Node.isComputedPropertyName(keyNode)
            ? `[${stringifyArgument(keyNode.getExpression())}]`
            : prop.getName()
          const value = stringifyArgument(prop.getInitializer()!)
          return `${key}: ${value}`
        }
        if (Node.isShorthandPropertyAssignment(prop)) {
          const name = prop.getName()
          const value = stringifyArgument(prop.getNameNode())
          if (value === name) return name
          return `${name}: ${value}`
        }
        if (Node.isSpreadAssignment(prop)) {
          return `...${stringifyArgument(prop.getExpression())}`
        }
        return prop.getText()
      })
      if (props.length === 0) return '{}'
      return `{ ${props.join(', ')} }`
    }

    if (Node.isArrayLiteralExpression(node)) {
      return `[${node.getElements().map(stringifyArgument).join(', ')}]`
    }

    if (Node.isIdentifier(node)) {
      const name = node.getText()
      const binding = resolveBindingInfo(name)
      if (binding && binding.paths.length > 0) {
        const path = binding.paths[0]
        const first = path[0]

        if ((first as any)?.sourceName) {
          if (first.name.startsWith('__target_')) return name
          if (path.some(p => p.isElement)) return name
          let result = (first as any).sourceName
          for (let i = 1; i < path.length; i++) {
            const seg = path[i]
            if (seg.name.startsWith('__')) continue
            result += '.' + seg.name
            if (seg.args !== undefined) result += '(' + seg.args + ')'
          }
          return result
        }

        if (first?.name.startsWith('__literal_')) {
          return first.name.replace('__literal_', '')
        }
      }
      return name
    }

    const kind = node.getKind()
    if (
      kind === SyntaxKind.StringLiteral ||
      kind === SyntaxKind.NumericLiteral ||
      kind === SyntaxKind.TrueKeyword ||
      kind === SyntaxKind.FalseKeyword ||
      kind === SyntaxKind.NullKeyword ||
      kind === SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      return node.getText()
    }

    if (Node.isConditionalExpression(node)) {
      const condition = stringifyArgument(node.getCondition())
      const whenTrue = stringifyArgument(node.getWhenTrue())
      const whenFalse = stringifyArgument(node.getWhenFalse())

      if (
        condition === 'true' ||
        (condition.startsWith('"') && condition !== '""') ||
        (!isNaN(Number(condition)) && Number(condition) !== 0)
      ) {
        return whenTrue
      }
      if (
        condition === 'false' ||
        condition === 'null' ||
        condition === 'undefined' ||
        condition === '0' ||
        condition === '""'
      ) {
        return whenFalse
      }
      return `${condition} ? ${whenTrue} : ${whenFalse}`
    }

    return node.getText()
  }

  interface Scope {
    bindings: Map<string, {paths: Path[]; isParam?: boolean}>
  }
  let scopes: Scope[] = [{bindings: new Map()}]
  function currentScope() {
    return scopes[scopes.length - 1]
  }

  let branchDepth = 0
  const exportedFunctionReturns = new Map<Node, Path[]>()

  function setBinding(
    identifier: string,
    paths: Path[],
    isDeclaration = false,
    isParam = false
  ) {
    let finalPaths = paths
    if (isDeclaration) {
      if (
        options.rootObjectName &&
        identifier === options.rootObjectName &&
        !finalPaths.some(p => p.length > 0 && (p[0] as any).sourceName)
      ) {
        currentScope().bindings.set(identifier, {paths: [[]], isParam})
        trackedNames.add(identifier)
        return
      }

      finalPaths = paths.map(p => {
        if (p.length > 0) {
          if (!(p[0] as any).sourceName) {
            return [{...p[0], sourceName: identifier} as any, ...p.slice(1)]
          }
        }
        return p
      })
    }

    if (!isDeclaration) {
      for (let i = scopes.length - 1; i >= 0; i--) {
        const existingBinding = scopes[i].bindings.get(identifier)
        if (existingBinding) {
          if (branchDepth > 0) {
            const existing = existingBinding.paths
            const combined = [...existing]
            const seen = new Set(combined.map(pathKey))
            for (const p of finalPaths) {
              const pk = pathKey(p)
              if (!seen.has(pk)) {
                seen.add(pk)
                combined.push(p)
              }
            }
            scopes[i].bindings.set(identifier, {
              paths: combined,
              isParam: existingBinding.isParam
            })
          } else {
            scopes[i].bindings.set(identifier, {paths: finalPaths, isParam})
          }
          return
        }
      }
    }
    currentScope().bindings.set(identifier, {paths: finalPaths, isParam})
    if (finalPaths.length > 0) trackedNames.add(identifier)
  }

  function hasBinding(identifier: string): boolean {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].bindings.has(identifier)) return true
    }
    if (options.rootObjectName && identifier === options.rootObjectName)
      return true
    return false
  }

  function resolveBinding(identifier: string): Path[] {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const b = scopes[i].bindings.get(identifier)
      if (b) return b.paths
    }
    return []
  }

  function resolveBindingInfo(
    identifier: string
  ): {paths: Path[]; isParam?: boolean} | undefined {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const b = scopes[i].bindings.get(identifier)
      if (b) return b
    }
    return undefined
  }

  let lastReturnedPaths: Path[] = []

  function markAsList(paths: Path[]) {
    paths.forEach(path => {
      mergePathAndArgs(result, path, true)
      if (path.length > 0) {
        const lastSegment = path[path.length - 1] as any
        if (!lastSegment.__isVirtual) {
          lastSegment.__isList = true
        }
      }
    })
  }

  function bindParam(
    paramNameNode: Node,
    paths: Path[],
    isDeclaration = false
  ) {
    if (Node.isIdentifier(paramNameNode)) {
      setBinding(paramNameNode.getText(), paths, isDeclaration, true)
    } else if (
      Node.isObjectBindingPattern(paramNameNode) ||
      Node.isArrayBindingPattern(paramNameNode)
    ) {
      handleDestructuring(paramNameNode, paths, isDeclaration)
    }
  }

  function executeFunctionBody(
    body: Node | undefined,
    bindParams?: () => void,
    isolate: boolean = false
  ): Path[] {
    if (!body) return []

    const oldScopes = scopes
    if (isolate) {
      scopes = [oldScopes[0], {bindings: new Map()}]
    } else {
      scopes.push({bindings: new Map()})
    }

    if (bindParams) bindParams()

    let paths: Path[] = []
    if (Node.isBlock(body)) {
      const prevReturned = lastReturnedPaths
      lastReturnedPaths = []
      body.getStatements().forEach(analyzeStatement)
      paths = lastReturnedPaths
      lastReturnedPaths = prevReturned
    } else {
      paths = evaluateExpression(body)
    }

    if (isolate) {
      scopes = oldScopes
    } else {
      scopes.pop()
    }
    return paths
  }

  function bindIteratorParam(
    params: any[],
    basePaths: Path[],
    methodName: string
  ) {
    const paramIndex = methodName === 'reduce' ? 1 : 0
    if (params.length > paramIndex) {
      const elementPaths = basePaths.map(p => [
        ...p,
        {name: '__element', isElement: true}
      ])
      bindParam(params[paramIndex].getNameNode(), elementPaths)
    }
  }

  function withRecursionGuard<T>(
    decl:
      | FunctionDeclaration
      | ArrowFunction
      | FunctionExpression
      | MethodDeclaration,
    fn: () => T
  ): T | undefined {
    const count = visitedDecls.get(decl) || 0
    if (count >= MAX_RECURSION_PER_DECL || currentDepth >= MAX_DEPTH) {
      return undefined
    }
    visitedDecls.set(decl, count + 1)
    currentDepth++
    const sourceFile = decl.getSourceFile()
    if (options.onFileAccess) options.onFileAccess(sourceFile)

    try {
      return fn()
    } finally {
      currentDepth--
      const newCount = (visitedDecls.get(decl) || 1) - 1
      if (newCount <= 0) visitedDecls.delete(decl)
      else visitedDecls.set(decl, newCount)
    }
  }

  const functionRegistry = new Map<
    string,
    FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration
  >()

  function handleDestructuring(
    pattern: BindingPattern,
    paths: Path[],
    isDeclaration = false
  ) {
    if (Node.isObjectBindingPattern(pattern)) {
      for (const element of pattern.getElements()) {
        let propName = ''
        const propertyNameNode = element.getPropertyNameNode()
        const nameNode = element.getNameNode()

        if (element.getDotDotDotToken()) {
          if (Node.isIdentifier(nameNode)) {
            setBinding(nameNode.getText(), paths, isDeclaration)
          }
          continue
        }

        if (propertyNameNode) {
          propName = propertyNameNode.getText()
        } else if (Node.isIdentifier(nameNode)) {
          propName = nameNode.getText()
        }

        if (propName) {
          if (propName.startsWith('$') && propName !== '$on') continue

          const propPrefix = `__prop_${propName}`
          const matches = paths.filter(p => p[0]?.name === propPrefix)
          let nextPaths: Path[]
          if (matches.length > 0) {
            nextPaths = matches.map(p => p.slice(1))
          } else {
            nextPaths = paths.map(p => [...p, {name: propName}])
          }

          nextPaths.forEach(p => mergePathAndArgs(result, p))

          if (Node.isIdentifier(nameNode)) {
            setBinding(nameNode.getText(), nextPaths, isDeclaration)
          } else if (
            Node.isObjectBindingPattern(nameNode) ||
            Node.isArrayBindingPattern(nameNode)
          ) {
            handleDestructuring(nameNode, nextPaths, isDeclaration)
          }
        }
      }
    } else if (Node.isArrayBindingPattern(pattern)) {
      const elements = pattern.getElements()
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i]
        if (!Node.isOmittedExpression(element)) {
          const nameNode = element.getNameNode()
          const indexPrefix = `__index_${i}`
          const elementPaths = paths
            .filter(p => p[0]?.name === indexPrefix)
            .map(p => p.slice(1))

          const finalPaths = elementPaths.length > 0 ? elementPaths : paths

          if (Node.isIdentifier(nameNode)) {
            setBinding(nameNode.getText(), finalPaths, isDeclaration)
          } else if (
            Node.isObjectBindingPattern(nameNode) ||
            Node.isArrayBindingPattern(nameNode)
          ) {
            handleDestructuring(nameNode, finalPaths, isDeclaration)
          }
        }
      }
    }
  }

  const visitedDecls = new Map<
    | FunctionDeclaration
    | ArrowFunction
    | FunctionExpression
    | MethodDeclaration,
    number
  >()
  let currentDepth = 0
  const MAX_DEPTH = 10
  const MAX_RECURSION_PER_DECL = 2

  function resolveFunctionDefinition(
    symbol: any,
    onFileAccess?: (sf: SourceFile) => void
  ): any {
    if (!symbol) return undefined

    let currentSym = symbol
    const visitedSyms = new Set<any>()

    while (currentSym && !visitedSyms.has(currentSym)) {
      visitedSyms.add(currentSym)
      const prevSym = currentSym
      const decls = currentSym.getDeclarations()
      if (onFileAccess && decls) {
        decls.forEach((d: any) => onFileAccess(d.getSourceFile()))
      }

      let decl = decls?.find(
        (d: any) =>
          Node.isFunctionDeclaration(d) ||
          Node.isArrowFunction(d) ||
          Node.isFunctionExpression(d) ||
          Node.isMethodDeclaration(d)
      )

      if (!decl) {
        const varDecl = decls?.find(
          (d: any) =>
            Node.isVariableDeclaration(d) || Node.isPropertyAssignment(d)
        )
        if (
          varDecl &&
          (Node.isVariableDeclaration(varDecl) ||
            Node.isPropertyAssignment(varDecl))
        ) {
          let initializer = varDecl.getInitializer()
          while (initializer) {
            if (
              Node.isAsExpression(initializer) ||
              Node.isParenthesizedExpression(initializer)
            ) {
              initializer = initializer.getExpression()
              continue
            }
            if (Node.isCallExpression(initializer)) {
              const args = initializer.getArguments()
              let foundSubDecl = false
              for (const arg of args) {
                const argSym = getSymbol(arg)
                let subDecl
                if (argSym) {
                  subDecl = resolveFunctionDefinition(argSym, onFileAccess)
                }
                if (subDecl) {
                  initializer = subDecl as any
                  foundSubDecl = true
                  break
                } else if (
                  Node.isArrowFunction(arg) ||
                  Node.isFunctionExpression(arg)
                ) {
                  initializer = arg
                  foundSubDecl = true
                  break
                }
              }
              if (foundSubDecl) continue
            }
            if (Node.isIdentifier(initializer)) {
              const sym = getSymbol(initializer)
              if (sym && !visitedSyms.has(sym)) {
                currentSym = sym
                break
              }
            }
            break
          }

          if (initializer && !Node.isIdentifier(initializer)) {
            if (
              Node.isArrowFunction(initializer) ||
              Node.isFunctionExpression(initializer)
            ) {
              decl = initializer
            }
          }
          if (decl) return decl
          if (currentSym !== prevSym) continue
        }
      }

      if (decl) return decl

      try {
        const aliased = currentSym.getAliasedSymbol()
        if (aliased && aliased !== currentSym) {
          currentSym = aliased
          continue
        }
      } catch (e) {}

      break
    }
    return undefined
  }

  function executeIfFunction(
    paths: Path[],
    argsPaths: Path[][],
    isolate: boolean = false
  ): Path[] | undefined {
    let allRetPaths: Path[] = []
    let found = false

    for (const p of paths) {
      for (const segment of p) {
        if (segment.name === '__decl' && (segment as any).decl) {
          const fnDef = (segment as any).decl
          const retPaths = withRecursionGuard(fnDef, () => {
            return executeFunctionBody(
              fnDef.getBody(),
              () => {
                fnDef.getParameters().forEach((param: any, i: number) => {
                  if (i < argsPaths.length) {
                    bindParam(param.getNameNode(), argsPaths[i], true)
                  }
                })
              },
              isolate
            )
          })

          if (retPaths !== undefined) {
            allRetPaths.push(...retPaths)
            found = true
          }
        }
      }
    }
    return found ? allRetPaths : undefined
  }

  function evaluateExpression(originalNode: Node): Path[] {
    if (!originalNode) return []

    let node = originalNode
    let k = node.getKind()
    while (
      k === SyntaxKind.ParenthesizedExpression ||
      k === SyntaxKind.AsExpression ||
      k === SyntaxKind.TypeAssertionExpression ||
      k === SyntaxKind.NonNullExpression
    ) {
      node = (node as any).getExpression()
      k = node.getKind()
    }

    if (options.targetNodes) {
      const idx = options.targetNodes.indexOf(node)
      if (idx !== -1) {
        return [[{name: `__target_${idx}`}]]
      }
    }

    const kind = node.getKind()
    if (
      kind === SyntaxKind.StringLiteral ||
      kind === SyntaxKind.NumericLiteral ||
      kind === SyntaxKind.TrueKeyword ||
      kind === SyntaxKind.FalseKeyword ||
      kind === SyntaxKind.NullKeyword ||
      kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
      (kind === SyntaxKind.Identifier && node.getText() === 'undefined')
    ) {
      return [[{name: `__literal_${node.getText()}`}]]
    }

    if (Node.isIdentifier(node)) {
      const name = node.getText()
      if (hasBinding(name)) {
        return resolveBinding(name)
      }

      if (needsTypeChecker(node)) {
        const sym = getSymbol(node)
        const decl = resolveFunctionDefinition(sym, options.onFileAccess)
        if (decl) {
          return [[{name: '__decl', decl} as any]]
        }
      }

      return []
    }

    if (Node.isPropertyAccessExpression(node)) {
      const basePaths = evaluateExpression(node.getExpression())
      const name = node.getName()

      const propPrefix = `__prop_${name}`
      const matchingPaths = basePaths.filter(p => p[0]?.name === propPrefix)
      if (matchingPaths.length > 0) {
        return matchingPaths.map(p => p.slice(1))
      }

      if (JS_INTERNALS.has(name) || (name.startsWith('$') && name !== '$on')) {
        if (JS_ARRAY_METHODS.has(name)) markAsList(basePaths)
        return name === 'bind' ? basePaths : []
      }

      const parent = node.getParent()
      const isCallExpr =
        parent &&
        parent.getKind() === SyntaxKind.CallExpression &&
        (parent as any).getExpression() === node

      const newPaths: Path[] = []
      for (const path of basePaths) {
        const nextPath = [...path, {name: name}]
        if (!isCallExpr) {
          mergePathAndArgs(result, nextPath)
        }
        newPaths.push(nextPath)
      }
      return newPaths
    }

    if (Node.isObjectLiteralExpression(node)) {
      const paths: Path[] = []
      node.getProperties().forEach(prop => {
        if (Node.isPropertyAssignment(prop)) {
          const nameNode = prop.getNameNode()
          let name = ''
          if (Node.isComputedPropertyName(nameNode)) {
            const expr = nameNode.getExpression()
            if (Node.isStringLiteral(expr)) {
              name = expr.getLiteralText()
            }
          } else {
            name = prop.getName()
          }

          if (!name) return

          const init = prop.getInitializer()
          if (init) {
            if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
              functionRegistry.set(name, init)
            }
            const initPaths = evaluateExpression(init)
            if (initPaths.length === 0) {
              paths.push([{name: `__prop_${name}`}])
            } else {
              for (const ip of initPaths) {
                paths.push([{name: `__prop_${name}`}, ...ip])
              }
            }
          }
        } else if (Node.isShorthandPropertyAssignment(prop)) {
          const name = prop.getName()
          const initPaths = resolveBinding(name)
          if (initPaths.length === 0) {
            paths.push([{name: `__prop_${name}`}])
          } else {
            for (const ip of initPaths) {
              paths.push([{name: `__prop_${name}`}, ...ip])
            }
          }
        } else if (Node.isMethodDeclaration(prop)) {
          const name = prop.getName()
          functionRegistry.set(name, prop)
          paths.push([{name: `__prop_${name}`}])
        } else if (Node.isSpreadAssignment(prop)) {
          const spreadPaths = evaluateExpression(prop.getExpression())
          paths.push(...spreadPaths)
        }
      })
      return paths
    }

    if (Node.isArrayLiteralExpression(node)) {
      const paths: Path[] = []
      node.getElements().forEach(el => {
        let elPaths: Path[];
        if (Node.isSpreadElement(el)) {
          elPaths = evaluateExpression(el.getExpression())
          markAsList(elPaths)
        } else {
          elPaths = evaluateExpression(el)
        }
        
        elPaths.forEach(p => {
          paths.push([...p, { name: '__element', isElement: true, __isVirtual: true } as any])
        })
      })
      return paths
    }

    if (Node.isSpreadElement(node)) {
      return evaluateExpression(node.getExpression())
    }

    if (Node.isElementAccessExpression(node)) {
      const basePaths = evaluateExpression(node.getExpression())
      const argExpr = node.getArgumentExpression()

      if (argExpr) {
        const propNames: string[] = []

        if (
          Node.isStringLiteral(argExpr) ||
          Node.isNoSubstitutionTemplateLiteral(argExpr)
        ) {
          propNames.push(argExpr.getLiteralText())
        } else {
          const argPaths = evaluateExpression(argExpr)
          for (const path of argPaths) {
            for (const step of path) {
              if (step.name.startsWith('__literal_')) {
                let literal = step.name.slice(10)
                if (
                  (literal.startsWith("'") && literal.endsWith("'")) ||
                  (literal.startsWith('"') && literal.endsWith('"')) ||
                  (literal.startsWith('`') && literal.endsWith('`'))
                ) {
                  literal = literal.slice(1, -1)
                }
                propNames.push(literal)
              }
            }
          }
        }

        if (propNames.length > 0) {
          const newPaths: Path[] = []
          for (const propName of propNames) {
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propName)) {
              for (const path of basePaths) {
                const nextPath = [...path, {name: propName}]
                mergePathAndArgs(result, nextPath)
                newPaths.push(nextPath)
              }
            }
          }
          if (newPaths.length > 0) {
            return newPaths
          }
        }

        const baseType = getNodeType(node.getExpression())
        const argType = getNodeType(argExpr)

        if (
          baseType.isArray() ||
          baseType.isTuple() ||
          argType.isNumber() ||
          argType.isNumberLiteral() ||
          Node.isNumericLiteral(argExpr)
        ) {
          markAsList(basePaths)
        }
      }

      if (argExpr) evaluateExpression(argExpr)
      return basePaths
    }

    if (Node.isCallExpression(node)) {
      const args = node.getArguments()
      let argsString: string | undefined
      const getArgsString = () => {
        if (argsString === undefined) {
          argsString =
            args.length > 0
              ? args.map(arg => stringifyArgument(arg)).join(', ')
              : ''
        }
        return argsString
      }

      const expr = node.getExpression()

      const hookName = Node.isIdentifier(expr)
        ? expr.getText()
        : Node.isPropertyAccessExpression(expr)
          ? expr.getName()
          : ''
      if (hookName === 'useMemo') {
        const firstArg = args[0]
        if (firstArg) {
          const paths = evaluateExpression(firstArg)
          const retPaths = executeIfFunction(paths, [])
          return retPaths !== undefined ? retPaths : paths
        }
      }

      if (hookName === 'useCallback') {
        const firstArg = args[0]
        if (firstArg) {
          return evaluateExpression(firstArg)
        }
      }

      if (hookName === 'useState') {
        const firstArg = args[0]
        const initPaths = firstArg ? evaluateExpression(firstArg) : []
        const statePaths =
          initPaths.length > 0
            ? initPaths.map(p => [
                {name: '__index_0'},
                {name: '__state'} as any,
                ...p
              ])
            : [[{name: '__index_0'}, {name: '__state'} as any]]

        return [...statePaths, [{name: '__index_1'}]]
      }

      if (Node.isPropertyAccessExpression(expr)) {
        const methodName = expr.getName()
        const baseExpr = expr.getExpression()

        const basePaths = evaluateExpression(baseExpr)

        if (ITERATOR_METHODS.has(methodName)) {
          let baseType: any
          if (needsTypeChecker(baseExpr)) {
            baseType = getNodeType(baseExpr)
          }

          if (
            !JS_SHARED_METHODS.has(methodName) ||
            (baseType && !(baseType.isString() || baseType.isStringLiteral()))
          ) {
            markAsList(basePaths)
          }
          let callbackPaths: Path[] = []
          node.getArguments().forEach(originalArg => {
            let arg = originalArg
            while (Node.isParenthesizedExpression(arg)) {
              arg = arg.getExpression() as any
            }
            if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
              callbackPaths = executeFunctionBody(arg.getBody(), () => {
                bindIteratorParam(arg.getParameters(), basePaths, methodName)
              })
            } else if (Node.isIdentifier(arg)) {
              const fnName = arg.getText()
              let fnDef = functionRegistry.get(fnName)

              if (!fnDef) {
                const paths = resolveBinding(fnName)
                for (const p of paths) {
                  for (const s of p) {
                    if (s.name === '__decl' && (s as any).decl) {
                      fnDef = (s as any).decl
                      break
                    }
                  }
                  if (fnDef) break
                }
              }

              if (!fnDef) {
                let symbol: any
                if (needsTypeChecker(arg)) {
                  symbol = getSymbol(arg) || getNodeType(arg).getSymbol()
                }
                fnDef = resolveFunctionDefinition(symbol, options.onFileAccess)
              }
              if (fnDef) {
                const result = withRecursionGuard(fnDef, () => {
                  return executeFunctionBody(fnDef!.getBody(), () => {
                    bindIteratorParam(
                      fnDef!.getParameters(),
                      basePaths,
                      methodName
                    )
                  })
                })
                if (result) callbackPaths = result
              }
            } else {
              evaluateExpression(arg)
            }
          })

          return methodName === 'map' && callbackPaths.length > 0
            ? callbackPaths.map(p =>
                p.map((s, idx) =>
                  idx === p.length - 1 &&
                  (s.name === '__element' ||
                    s.name.startsWith('__index_') ||
                    !p.some(s => s.name.startsWith('__prop_')))
                    ? {...s, __isVirtual: true}
                    : s
                )
              )
            : basePaths
        }

        if (JS_INTERNALS.has(methodName) || methodName.startsWith('$')) {
          if (JS_ARRAY_ONLY_METHODS.has(methodName)) {
            markAsList(basePaths)
          } else if (JS_SHARED_METHODS.has(methodName)) {
            if (needsTypeChecker(baseExpr)) {
              const baseType = getNodeType(baseExpr)
              if (!(baseType.isString() || baseType.isStringLiteral())) {
                markAsList(basePaths)
              }
            }
          }
          if (
            methodName === 'push' ||
            methodName === 'unshift' ||
            methodName === 'splice'
          ) {
            node.getArguments().forEach((arg, i) => {
              if (methodName === 'splice' && i < 2) {
                evaluateExpression(arg)
                return
              }
              const argPaths = evaluateExpression(arg)
              basePaths.push(...argPaths)
            })
          } else {
            node.getArguments().forEach(arg => evaluateExpression(arg) || [])
          }
          return methodName === 'bind' ? basePaths : []
        }

        let methodFnDef = functionRegistry.get(methodName)

        if (!methodFnDef) {
          if (needsTypeChecker(expr)) {
            const methodSymbol = getSymbol(expr)
            methodFnDef = resolveFunctionDefinition(
              methodSymbol,
              options.onFileAccess
            )
          }
        }

        if (!methodFnDef) {
          const nameNode = expr.getNameNode()
          if (nameNode && needsTypeChecker(nameNode)) {
            const nameSym = getSymbol(nameNode)
            if (nameSym) {
              methodFnDef = resolveFunctionDefinition(
                nameSym,
                options.onFileAccess
              )
            }
          }
        }

        const methodArgsPaths: Path[][] = node
          .getArguments()
          .map(arg => evaluateExpression(arg))

        const callPaths = evaluateExpression(expr)
        const retPaths = executeIfFunction(callPaths, methodArgsPaths)
        if (retPaths !== undefined) return retPaths

        const newPaths: Path[] = []
        for (const path of basePaths) {
          const nextPath = [...path, {name: methodName, args: getArgsString()}]
          mergePathAndArgs(result, nextPath)
          newPaths.push(nextPath)
        }
        return newPaths
      }

      let basePathsForCall: Path[] = []
      if (Node.isIdentifier(expr)) {
        const fnName = expr.getText()
        let fnDef = functionRegistry.get(fnName)

        if (!fnDef) {
          if (needsTypeChecker(expr)) {
            const symbol = getSymbol(expr) || getNodeType(expr).getSymbol()
            fnDef = resolveFunctionDefinition(symbol, options.onFileAccess)
          }
        }

        const argsPaths: Path[][] = node
          .getArguments()
          .map(arg => evaluateExpression(arg))

        const callPaths = evaluateExpression(expr)
        const retPaths = executeIfFunction(callPaths, argsPaths)
        if (retPaths !== undefined) return retPaths

        if (fnDef) {
          const retPaths = withRecursionGuard(fnDef, () => {
            return executeFunctionBody(fnDef!.getBody(), () => {
              fnDef!.getParameters().forEach((param, i) => {
                if (i < argsPaths.length) {
                  bindParam(param.getNameNode(), argsPaths[i], true)
                }
              })
            })
          })
          if (retPaths) return retPaths
        }

        basePathsForCall = resolveBinding(fnName)
      } else {
        basePathsForCall = evaluateExpression(expr)
      }

      if (basePathsForCall.length > 0) {
        const newPaths: Path[] = []
        for (const path of basePathsForCall) {
          if (path.length > 0) {
            const last = path[path.length - 1]
            const nextPath = [
              ...path.slice(0, -1),
              {...last, args: getArgsString()}
            ]
            mergePathAndArgs(result, nextPath)
            newPaths.push(nextPath)
          }
        }
        if (newPaths.length > 0) return newPaths
      }

      return []
    }

    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
      const tagNameNode = node.getTagNameNode()
      const tagNameString = tagNameNode.getText()

      let decl: any

      // OPTIMIZATION: Only try to resolve definitions for Custom Components.
      // Bypass expensive DOM lib lookups for intrinsic tags like <div>,
      // but DO NOT return early so we can still process their onClick/onChange attributes!
      if (!/^[a-z]/.test(tagNameString)) {
        if (Node.isIdentifier(tagNameNode)) {
          decl = functionRegistry.get(tagNameString)

          if (!decl) {
            const paths = resolveBinding(tagNameString)
            for (const p of paths) {
              for (const s of p) {
                if (s.name === '__decl' && (s as any).decl) {
                  decl = (s as any).decl
                  break
                }
              }
              if (decl) break
            }
          }
        }

        if (!decl) {
          let symbol: any
          if (needsTypeChecker(tagNameNode)) {
            symbol =
              getSymbol(tagNameNode) || getNodeType(tagNameNode).getSymbol()
          }
          decl = resolveFunctionDefinition(symbol, options.onFileAccess)
        }
      }

      // ⬇️ ALWAYS runs, processing onClick, onChange, etc. for BOTH custom and HTML elements
      const attributes = node.getAttributes()
      const propsPaths: Map<string, Path[]> = new Map()

      attributes.forEach(attr => {
        if (Node.isJsxAttribute(attr)) {
          const name = attr.getNameNode().getText()
          const initializer = attr.getInitializer()
          if (initializer) {
            const valPaths = Node.isJsxExpression(initializer)
              ? evaluateExpression(initializer.getExpression()!)
              : evaluateExpression(initializer)
            propsPaths.set(name, valPaths)

            executeIfFunction(valPaths, [])
          }
        } else if (Node.isJsxSpreadAttribute(attr)) {
          const expr = attr.getExpression()
          const spreadPaths = evaluateExpression(expr)
          for (const path of spreadPaths) {
            if (path[0]?.name.startsWith('__prop_')) {
              const propName = path[0].name.replace('__prop_', '')
              const existing = propsPaths.get(propName) || []
              propsPaths.set(propName, [...existing, path.slice(1)])
            }
          }
        }
      })

      if (decl) {
        withRecursionGuard(decl, () => {
          return executeFunctionBody(
            decl.getBody(),
            () => {
              const params = decl.getParameters()
              if (params.length > 0) {
                const propsParam = params[0].getNameNode()
                if (Node.isObjectBindingPattern(propsParam)) {
                  const destructuredNames = new Set<string>()
                  for (const el of propsParam.getElements()) {
                    if (!el.getDotDotDotToken()) {
                      destructuredNames.add(
                        el.getPropertyNameNode()?.getText() || el.getName()
                      )
                    }
                  }
                  for (const element of propsParam.getElements()) {
                    if (element.getDotDotDotToken()) {
                      const allPaths: Path[] = []
                      propsPaths.forEach((paths, name) => {
                        if (!destructuredNames.has(name)) {
                          paths.forEach(p => {
                            allPaths.push([{name: `__prop_${name}`}, ...p])
                          })
                        }
                      })
                      bindParam(element.getNameNode(), allPaths, true)
                    } else {
                      const name =
                        element.getPropertyNameNode()?.getText() ||
                        element.getName()
                      const paths = propsPaths.get(name) || []
                      bindParam(element.getNameNode(), paths, true)
                    }
                  }
                } else {
                  const allPaths: Path[] = []
                  propsPaths.forEach((paths, name) => {
                    paths.forEach(p => {
                      allPaths.push([{name: `__prop_${name}`}, ...p])
                    })
                  })
                  bindParam(propsParam, allPaths, true)
                }
              }
            },
            true
          )
        })
      }

      return []
    }

    if (Node.isConditionalExpression(node)) {
      evaluateExpression(node.getCondition())
      branchDepth++
      const truePaths = evaluateExpression(node.getWhenTrue())
      const falsePaths = evaluateExpression(node.getWhenFalse())
      branchDepth--
      return [...truePaths, ...falsePaths]
    }

    if (
      Node.isBinaryExpression(node) &&
      node.getOperatorToken().getKind() === SyntaxKind.EqualsToken
    ) {
      const right = node.getRight()
      const left = node.getLeft()
      const paths = evaluateExpression(right)
      if (Node.isIdentifier(left)) {
        setBinding(left.getText(), paths)
      } else {
        evaluateExpression(left)
      }
      return paths
    }

    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const resultPaths = executeFunctionBody(node.getBody())
      return [[{name: '__decl', decl: node as any} as any], ...resultPaths]
    }

    if (Node.isBinaryExpression(node)) {
      const left = evaluateExpression(node.getLeft())
      const right = evaluateExpression(node.getRight())
      return [...left, ...right]
    }

    node.forEachChild(child => {
      evaluateExpression(child)
    })

    return []
  }

  function analyzeStatement(stmt: Node) {
    if (Node.isVariableStatement(stmt)) {
      for (const decl of stmt.getDeclarations()) {
        const initializer = decl.getInitializer()
        const paths = initializer ? evaluateExpression(initializer) : []
        const nameNode = decl.getNameNode()
        const name = nameNode.getText()

        if (
          initializer &&
          (Node.isArrowFunction(initializer) ||
            Node.isFunctionExpression(initializer))
        ) {
          functionRegistry.set(name, initializer)
          const containsTarget =
            !options.targetNodes ||
            options.targetNodes.some(
              target =>
                initializer.getStart() <= target.getStart() &&
                initializer.getEnd() >= target.getEnd()
            )
          if (containsTarget) {
            executeFunctionBody(initializer.getBody())
          }
        }

        bindParam(nameNode, paths, true)
      }
    } else if (Node.isExpressionStatement(stmt)) {
      evaluateExpression(stmt.getExpression())
    } else if (Node.isIfStatement(stmt)) {
      evaluateExpression(stmt.getExpression())
      branchDepth++
      analyzeStatement(stmt.getThenStatement())
      const elseStmt = stmt.getElseStatement()
      if (elseStmt) analyzeStatement(elseStmt)
      branchDepth--
    } else if (Node.isSwitchStatement(stmt)) {
      evaluateExpression(stmt.getExpression())
      branchDepth++
      stmt.getClauses().forEach(clause => {
        clause.getStatements().forEach(analyzeStatement)
      })
      branchDepth--
    } else if (Node.isForStatement(stmt)) {
      const initializer = stmt.getInitializer()
      if (initializer && Node.isVariableDeclarationList(initializer)) {
        scopes.push({bindings: new Map()})
        for (const decl of initializer.getDeclarations()) {
          const init = decl.getInitializer()
          if (init) {
            const paths = evaluateExpression(init)
            bindParam(decl.getNameNode(), paths)
          }
        }
      }
      const condition = stmt.getCondition()
      if (condition) evaluateExpression(condition)
      const incrementor = stmt.getIncrementor()
      if (incrementor) evaluateExpression(incrementor)
      analyzeStatement(stmt.getStatement())
      if (initializer && Node.isVariableDeclarationList(initializer)) {
        scopes.pop()
      }
    } else if (Node.isForOfStatement(stmt)) {
      scopes.push({bindings: new Map()})
      const paths = evaluateExpression(stmt.getExpression())
      markAsList(paths)
      const initializer = stmt.getInitializer()
      if (Node.isVariableDeclarationList(initializer)) {
        for (const decl of initializer.getDeclarations()) {
          bindParam(decl.getNameNode(), paths)
        }
      }
      analyzeStatement(stmt.getStatement())
      scopes.pop()
    } else if (Node.isBlock(stmt)) {
      const stmts = stmt.getStatements()
      if (stmts.length > 5 && !textMentionsTracked(stmt)) return
      scopes.push({bindings: new Map()})
      stmts.forEach(analyzeStatement)
      scopes.pop()
    } else if (Node.isReturnStatement(stmt)) {
      const expr = stmt.getExpression()
      if (expr) {
        lastReturnedPaths = evaluateExpression(expr)

        if (lastReturnedPaths.length > 0) {
          let parent: Node | undefined = stmt.getParent()
          while (
            parent &&
            !Node.isFunctionDeclaration(parent) &&
            !Node.isArrowFunction(parent) &&
            !Node.isFunctionExpression(parent)
          ) {
            parent = parent.getParent()
          }

          if (
            parent &&
            (Node.isFunctionDeclaration(parent) ||
              Node.isArrowFunction(parent) ||
              Node.isFunctionExpression(parent))
          ) {
            const existing = exportedFunctionReturns.get(parent) || []
            exportedFunctionReturns.set(parent, [
              ...existing,
              ...lastReturnedPaths
            ])
          }
        }
      }
    } else if (Node.isFunctionDeclaration(stmt)) {
      const name = stmt.getName()
      if (name) functionRegistry.set(name, stmt)

      const containsTarget =
        !options.targetNodes ||
        options.targetNodes.some(
          target =>
            stmt.getStart() <= target.getStart() &&
            stmt.getEnd() >= target.getEnd()
        )

      if (containsTarget) {
        scopes.push({bindings: new Map()})
        executeFunctionBody(stmt.getBody())
        scopes.pop()
      }
    } else {
      stmt.forEachChild(analyzeStatement)
    }
  }

  const walkOuter = (node: Node) => {
    if (Node.isFunctionDeclaration(node)) {
      const name = node.getName()
      if (name) functionRegistry.set(name, node)

      const params = node.getParameters()
      if (params.length > 0 && options.rootObjectName) {
        const paramNameNode = params[0].getNameNode()
        if (Node.isObjectBindingPattern(paramNameNode)) {
          for (const el of paramNameNode.getElements()) {
            const propName = el.getPropertyNameNode()?.getText() || el.getName()

            if (propName === options.rootObjectName) {
              scopes.push({bindings: new Map()})
              bindParam(el.getNameNode(), [[]])
              const body = node.getBody()
              if (body && Node.isBlock(body)) {
                body.getStatements().forEach(analyzeStatement)
              }
              scopes.pop()
            }
          }
        }
      }
    }

    if (Node.isFunctionDeclaration(node) && !options.targetNodes) {
      const body = node.getBody()
      if (body && !textMentionsTracked(body)) return
    }

    if (Node.isStatement(node)) {
      analyzeStatement(node)
    } else {
      node.forEachChild(walkOuter)
    }
  }

  walkOuter(sourceFile)

  return {result, exportedFunctionReturns}
}

export interface AnalysisResult {
  result: Record<string, SelectorNode>
  exportedFunctionReturns: Map<Node, Path[]>
}

// OPTIMIZED: Cache the Project globally. Reinstantiating Project and loading default libs takes ~50-100ms.
let _sharedProject: Project | undefined

let projectAnalysisCaches = new WeakMap<Project, Map<string, any>>()
let projectReferencesCaches = new WeakMap<Project, Map<Node, any[]>>()
let projectQueriesCaches = new WeakMap<Project, Map<string, any>>()

// Exported utility to clear the project/cache when builds restart (used by esbuild)
export function clearAnalyzeCache() {
  _sharedProject = undefined
  // ADD THIS LINE:
  projectImporterGraphCache = new WeakMap()
  projectAnalysisCaches = new WeakMap()
  projectReferencesCaches = new WeakMap()
  projectQueriesCaches = new WeakMap()
}

export function extractAdvancedSelectors(
  sourceText: string,
  objectName: string = 'data'
): SelectorNode {
  if (!_sharedProject) {
    _sharedProject = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4, // ReactJSX
        skipLibCheck: true
      },
      useInMemoryFileSystem: true
    })
  }
  const project = _sharedProject
  const fileName = `temp_${Math.random().toString(36).substring(7)}.tsx`
  const sourceFile = project.createSourceFile(fileName, sourceText)

  const isDeclared =
    sourceFile.getVariableDeclaration(objectName) ||
    sourceFile.getFunction(objectName) ||
    sourceFile.getClass(objectName) ||
    sourceFile
      .getImportDeclarations()
      .some(imp =>
        imp
          .getNamedImports()
          .some(
            n =>
              n.getName() === objectName ||
              n.getAliasNode()?.getText() === objectName
          )
      )

  if (!isDeclared) {
    sourceFile.insertText(0, `const ${objectName} = {} as any;\n`)
  }

  const {result} = coreAnalyze(sourceFile, {rootObjectName: objectName})

  const clean = (obj: any) => {
    if (typeof obj !== 'object' || obj === null) return
    if (Array.isArray(obj)) {
      obj.forEach(clean)
      return
    }
    for (const key in obj) {
      if (
        key.startsWith('__prop_') ||
        key === '__decl' ||
        key === '__element'
      ) {
        delete obj[key]
      } else {
        clean(obj[key])
      }
    }
  }
  clean(result)

  // OPTIMIZED: Remove temp file to prevent memory leaks in shared project
  project.removeSourceFile(sourceFile)

  return result
}

// OPTIMIZED: Cache the importer graph per project so esbuild doesn't rebuild it exponentially.
let projectImporterGraphCache = new WeakMap<
  Project,
  Map<string, Set<SourceFile>>
>()

export function extractQueries(
  filePath: string,
  project: Project,
  options: {
    pylonPackage?: string
    hookName?: string
    skipDependencyResolution?: boolean
  } = {}
): {queries: QueryLocation[]; dependencies: string[]} {
  const persistentQueriesCache = projectQueriesCaches.get(project) || (() => {
    const map = new Map<string, any>()
    projectQueriesCaches.set(project, map)
    return map
  })()

  const persistentAnalysisCache = projectAnalysisCaches.get(project) || (() => {
    const map = new Map<string, any>()
    projectAnalysisCaches.set(project, map)
    return map
  })()

  const persistentReferencesCache = projectReferencesCaches.get(project) || (() => {
    const map = new Map<Node, any[]>()
    projectReferencesCaches.set(project, map)
    return map
  })()

  const {pylonPackage = '@getcronit/pylon/pages', hookName = 'useData'} =
    options
  const sourceFile = project.getSourceFileOrThrow(filePath)

  const contentHash = crypto.createHash('sha1').update(sourceFile.getFullText()).digest('hex')
  const cacheKey = filePath + ':' + contentHash + ':' + pylonPackage + ':' + hookName
  const cached = persistentQueriesCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const accessedFiles = new Set<string>()
  accessedFiles.add(filePath)

  if (!options.skipDependencyResolution) {
    project.resolveSourceFileDependencies()
  }

  // OPTIMIZED: Early abort utilizing strict text inclusions logic. Bypasses ts-morph entirely for native files.
  const targetNodes = findUseQueries(sourceFile, pylonPackage, hookName)
  if (targetNodes.length === 0) {
    const result = {queries: [], dependencies: Array.from(accessedFiles)}
    persistentQueriesCache.set(cacheKey, result)
    return result
  }

  const {result, exportedFunctionReturns} = coreAnalyze(sourceFile, {
    targetNodes,
    onFileAccess: sf => accessedFiles.add(sf.getFilePath())
  })

  const processedCallSites = new Set<Node>()
  const functionQueue: Array<[Node, Path[]]> = Array.from(
    exportedFunctionReturns.entries()
  )
  const processedFunctions = new Set<Node>()

  let directImporterGraph = projectImporterGraphCache.get(project)

  function buildImporterGraph() {
    if (directImporterGraph) return
    directImporterGraph = new Map<string, Set<SourceFile>>()

    function addToGraph(importedPath: string, importer: SourceFile) {
      let set = directImporterGraph!.get(importedPath)
      if (!set) {
        set = new Set()
        directImporterGraph!.set(importedPath, set)
      }
      set.add(importer)
    }

    project.getSourceFiles().forEach(sf => {
      // OPTIMIZED: Fast filter to avoid evaluating AST declarations for unrelated utility files.
      const text = sf.compilerNode.text
      if (!text.includes('import') && !text.includes('export')) return

      sf.getImportDeclarations().forEach(imp => {
        const moduleSF = imp.getModuleSpecifierSourceFile()
        if (moduleSF) addToGraph(moduleSF.getFilePath(), sf)
      })
      sf.getExportDeclarations().forEach(exp => {
        const moduleSF = exp.getModuleSpecifierSourceFile()
        if (moduleSF) addToGraph(moduleSF.getFilePath(), sf)
      })
    })

    projectImporterGraphCache.set(project, directImporterGraph)
  }

  function getTransitiveImporters(
    sfPath: string,
    visited = new Set<string>()
  ): Set<SourceFile> {
    const result = new Set<SourceFile>()
    const direct = directImporterGraph?.get(sfPath)
    if (!direct) return result

    visited.add(sfPath)
    for (const importer of direct) {
      result.add(importer)
      const impPath = importer.getFilePath()
      if (!visited.has(impPath)) {
        const sub = getTransitiveImporters(impPath, visited)
        sub.forEach(s => result.add(s))
      }
    }
    return result
  }

  function findCallSitesInFile(sf: SourceFile, fnName: string): Node[] {
    // OPTIMIZED: Native fast-path string check. If the exact function string
    // isn't in the raw text, don't waste time walking the descendants.
    if (!sf.compilerNode.text.includes(fnName)) return []

    return sf.getDescendantsOfKind(SyntaxKind.CallExpression).filter(call => {
      const expr = call.getExpression()
      const name = Node.isIdentifier(expr)
        ? expr.getText()
        : Node.isPropertyAccessExpression(expr)
          ? expr.getName()
          : ''
      return name === fnName
    })
  }

  function getCachedReferences(fn: Node): any[] {
    let refs = persistentReferencesCache.get(fn)
    if (refs !== undefined) return refs
    refs = ((fn as any).findReferences?.() || []) as any[]
    persistentReferencesCache.set(fn, refs)
    return refs
  }

  function getCachedAnalysis(sf: SourceFile, targets: Node[]): AnalysisResult {
    const contentHash = crypto.createHash('sha1').update(sf.getFullText()).digest('hex')
    const cacheKey =
      sf.getFilePath() +
      ':' +
      contentHash +
      ':' +
      targets.map(t => t.getStart() + '-' + t.getEnd()).join(',')
    const cached = persistentAnalysisCache.get(cacheKey)
    if (cached) {
      cached.accessedFiles.forEach((file: string) => accessedFiles.add(file))
      return cached.analysisResult
    }

    const localAccessedFiles = new Set<string>()
    const analysisResult = coreAnalyze(sf, {
      targetNodes: targets,
      onFileAccess: s => {
        localAccessedFiles.add(s.getFilePath())
        accessedFiles.add(s.getFilePath())
      }
    })

    persistentAnalysisCache.set(cacheKey, {
      analysisResult,
      accessedFiles: localAccessedFiles
    })
    return analysisResult
  }

  while (functionQueue.length > 0) {
    const [fn, paths] = functionQueue.shift()!
    if (processedFunctions.has(fn)) continue
    processedFunctions.add(fn)

    const targetPaths = paths.filter(p =>
      p.some(step => step.name.startsWith('__target_'))
    )
    if (targetPaths.length === 0) continue

    buildImporterGraph()

    const callNodes: Node[] = []

    if (
      Node.isFunctionDeclaration(fn) ||
      Node.isArrowFunction(fn) ||
      Node.isFunctionExpression(fn)
    ) {
      let name = (fn as any).getName?.()
      const sf = fn.getSourceFile()
      const sfPath = sf.getFilePath()

      // Resolve name for arrow functions or function expressions assigned to variables/properties
      if (!name) {
        const parent = fn.getParent()
        if (Node.isVariableDeclaration(parent)) {
          name = parent.getName()
        } else if (Node.isPropertyAssignment(parent)) {
          name = parent.getName()
        }
      }

      // Check if it is default exported
      let isDefaultExport = false
      let isExported = false
      if (Node.isFunctionDeclaration(fn)) {
        isExported = fn.isExported()
        isDefaultExport = fn.isDefaultExport()
      } else if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
        const parent = fn.getParent()
        if (Node.isVariableDeclaration(parent)) {
          const varStmt = parent.getParent()?.getParent()
          if (Node.isVariableStatement(varStmt)) {
            isExported = varStmt.isExported()
            isDefaultExport = varStmt.isDefaultExport()
          }
        } else if (Node.isExportAssignment(parent)) {
          isDefaultExport = true
          isExported = true
        }
      }

      // Also check separate export default statements
      if (name && !isDefaultExport) {
        const defaultExport = sf.getExportAssignments().find(exp => !exp.isExportEquals())
        if (defaultExport && defaultExport.getExpression()?.getText() === name) {
          isDefaultExport = true
          isExported = true
        }
      }

      if (name) {
        callNodes.push(...findCallSitesInFile(sf, name))
      }

      const importers = getTransitiveImporters(sfPath)
      if (importers.size > 0 && (name || isDefaultExport)) {
        for (const importer of importers) {
          let importedName = name

          if (isDefaultExport) {
            // Find what name this default export was imported as in the importer file
            for (const imp of importer.getImportDeclarations()) {
              const moduleSF = imp.getModuleSpecifierSourceFile()
              if (moduleSF && moduleSF.getFilePath() === sfPath) {
                const defaultImport = imp.getImportClause()?.getDefaultImport()
                if (defaultImport) {
                  importedName = defaultImport.getText()
                  break
                }
              }
            }
          } else if (name) {
            // Named export: check if it is imported under an alias
            for (const imp of importer.getImportDeclarations()) {
              const moduleSF = imp.getModuleSpecifierSourceFile()
              if (moduleSF && moduleSF.getFilePath() === sfPath) {
                const namedBindings = imp.getImportClause()?.getNamedBindings()
                if (namedBindings && Node.isNamedImports(namedBindings)) {
                  for (const el of namedBindings.getElements()) {
                    if (el.getName() === name) {
                      const alias = el.getAliasNode()?.getText()
                      if (alias) {
                        importedName = alias
                      }
                      break
                    }
                  }
                }
              }
            }
          }

          if (importedName) {
            callNodes.push(...findCallSitesInFile(importer, importedName))
          }
        }
      }
    }

    if (callNodes.length === 0) {
      const references = getCachedReferences(fn)
      for (const refSymbol of references) {
        for (const match of refSymbol.getReferences()) {
          callNodes.push(match.getNode())
        }
      }
    }

    for (const node of callNodes) {
      if (processedCallSites.has(node)) continue
      processedCallSites.add(node)

      let call: Node | undefined = node
      while (call && !Node.isCallExpression(call)) {
        call = call.getParent()
      }

      if (call && Node.isCallExpression(call)) {
        accessedFiles.add(call.getSourceFile().getFilePath())
        const callerAnalysis = getCachedAnalysis(call.getSourceFile(), [call])

        for (const [
          newFn,
          newPaths
        ] of callerAnalysis.exportedFunctionReturns.entries()) {
          functionQueue.push([newFn, newPaths])
        }

        const externalSelectors = callerAnalysis.result['__target_0'] || {}

        const shadowedProperties = new Set<string>()
        for (const p of paths) {
          if (p[0]?.name.startsWith('__prop_')) {
            shadowedProperties.add(p[0].name.replace(/^__prop_/, ''))
          }
        }

        for (const tp of targetPaths) {
          const targetIdx = tp.findIndex(step =>
            step.name.startsWith('__target_')
          )
          if (targetIdx === -1) continue

          const prefixes = tp.slice(0, targetIdx)
          const suffixes = tp.slice(targetIdx + 1)

          let currentExt: any = externalSelectors
          let skip = false
          for (const pref of prefixes) {
            const cleanName = pref.name.replace(/^__prop_/, '')
            if (
              currentExt &&
              typeof currentExt === 'object' &&
              cleanName in currentExt
            ) {
              currentExt = currentExt[cleanName]
            } else {
              skip = true
              break
            }
          }
          if (skip || !currentExt) continue

          if (suffixes.length > 0 && typeof currentExt === 'object') {
            currentExt = {...currentExt}
            delete currentExt.__args
          }

          if (prefixes.length === 0 && typeof currentExt === 'object') {
            const filtered = {...currentExt}
            for (const shadow of shadowedProperties) {
              delete filtered[shadow]
            }
            currentExt = filtered
          }

          const targetKey = tp[targetIdx].name
          const subPath = tp.slice(targetIdx + 1)

          let currentLevel: any = result[targetKey] || (result[targetKey] = {})
          let parent: any = result
          let lastKey = targetKey

          for (let i = 0; i < subPath.length; i++) {
            const step = subPath[i]
            if (
              step.name === '__element' ||
              step.name === '__decl' ||
              step.name.startsWith('__prop_')
            ) {
              continue
            }
            const isLast = i === subPath.length - 1

            if (currentLevel[step.name] === true && !isLast) {
              currentLevel[step.name] = {}
            }

            parent = currentLevel
            lastKey = step.name

            if (isLast) {
              if (currentExt === true) {
                if (
                  !currentLevel[step.name] ||
                  currentLevel[step.name] === true
                ) {
                  currentLevel[step.name] = true
                }
              } else if (
                typeof currentExt === 'object' &&
                Object.keys(currentExt).length > 0
              ) {
                if (
                  !currentLevel[step.name] ||
                  currentLevel[step.name] === true
                ) {
                  currentLevel[step.name] = {}
                }
                deepMerge(currentLevel[step.name], currentExt)
              } else {
                if (currentLevel[step.name] === undefined) {
                  currentLevel[step.name] = true
                }
              }
              break
            }

            currentLevel =
              currentLevel[step.name] || (currentLevel[step.name] = {})
          }
          continue
        }
      }
    }
  }

  const finalResult = {
    queries: targetNodes.map((node: any, idx) => ({
      start: node.getStart(),
      end: node.getEnd(),
      selectors: result[`__target_${idx}`] || {},
      node
    })),
    dependencies: Array.from(accessedFiles)
  }
  persistentQueriesCache.set(cacheKey, finalResult)
  return finalResult
}

function deepMerge(target: any, source: any) {
  if (!source || typeof source !== 'object') return

  for (const key in source) {
    if (key === '__element' || key.startsWith('__prop_') || key === '__decl') {
      continue
    }

    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {}
      }
      deepMerge(target[key], source[key])
    } else {
      if (source[key] === true && typeof target[key] === 'object') {
        continue
      }
      target[key] = source[key]
    }
  }
}

function findUseQueries(
  sourceFile: SourceFile,
  pylonPackage: string,
  hookName: string
): Node[] {
  // OPTIMIZED: Instant abort if the hook name isn't even in the file text.
  if (!sourceFile.compilerNode.text.includes(hookName)) return []

  const useQueryAliases = new Set<string>()
  const targetNodes: Node[] = []

  const visit = (node: Node) => {
    if (Node.isImportDeclaration(node)) {
      const moduleSpecifier = node.getModuleSpecifierValue()
      if (moduleSpecifier === pylonPackage) {
        const importClause = node.getImportClause()
        if (importClause) {
          const namedBindings = importClause.getNamedBindings()
          if (namedBindings && Node.isNamedImports(namedBindings)) {
            for (const el of namedBindings.getElements()) {
              const originalName = el.getNameNode().getText()
              const aliasNode = el.getAliasNode()
              const localName = aliasNode ? aliasNode.getText() : originalName

              if (originalName === hookName) {
                useQueryAliases.add(localName)
              }
            }
          }
        }
      }
    } else if (Node.isCallExpression(node)) {
      const expression = node.getExpression()
      if (
        Node.isIdentifier(expression) &&
        useQueryAliases.has(expression.getText())
      ) {
        targetNodes.push(node)
      }
    }
    node.forEachChild(visit)
  }

  visit(sourceFile)
  return targetNodes
}
