import {
  ArrowFunction,
  BindingPattern,
  FunctionDeclaration,
  FunctionExpression,
  MethodDeclaration,
  Node,
  Project,
  SourceFile,
  SyntaxKind
} from 'ts-morph'

export type SelectorNode = {
  [key: string]: SelectorNode | SelectorNode[] | boolean | string | undefined
  __args?: string
  __isList?: boolean
}

type PathSegment = {name: string; args?: string}
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
  const checker = sourceFile.getProject().getTypeChecker()

  // ── Memoized symbol / type lookups (Opt 4) ──
  const symbolCache = new WeakMap<Node, any>()
  function getSymbol(node: Node): any {
    let sym = symbolCache.get(node)
    if (sym !== undefined) return sym
    sym = (node as any).getSymbol?.() || checker.getSymbolAtLocation(node)
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
    'Buffer'
  ])

  function needsTypeChecker(node: Node): boolean {
    if (!Node.isIdentifier(node)) return true
    const name = node.getText()
    // If it's a known global, we don't need the checker to know it's not our data
    if (WELL_KNOWN_GLOBALS.has(name)) return false
    // If it's resolved via lexical scope as data flow, we don't need the checker
    if (resolveBinding(name).length > 0) return false
    // If it's a known local function, we don't need the checker
    if (functionRegistry.has(name)) return false
    // Otherwise, we might need the checker to resolve imports or local variables (like HOCs/Contexts)
    return true
  }

  // (constant Sets are now at module level)

  // ── Opt C: AST pre-filtering — skip subtrees that don't mention tracked identifiers ──
  // Build initial set of names that could carry data flow.
  // This set is grown as new aliases are discovered via setBinding.
  const trackedNames = new Set<string>()
  if (options.rootObjectName) {
    trackedNames.add(options.rootObjectName)
  }
  // For targetNodes mode, we need the text of identifiers around the target calls
  // (e.g. the variable that binds useData()'s return). We'll populate this lazily
  // as setBinding creates new aliases.

  /**
   * Fast check: does the raw text of a node mention any tracked identifier?
   * Used to skip entire AST subtrees that can't possibly affect data flow.
   * Only applied to blocks with >3 statements to amortize getText() cost.
   */
  function textMentionsTracked(node: Node): boolean {
    if (trackedNames.size === 0) return true // can't filter if nothing tracked yet
    const text = node.getText()
    for (const name of trackedNames) {
      if (text.includes(name)) return true
    }
    return false
  }

  function mergePathAndArgs(
    tree: Record<string, SelectorNode>,
    path: Path,
    isList: boolean = false
  ) {
    if (path.length === 0) return
    let current: any = tree

    for (let i = 0; i < path.length; i++) {
      const step = path[i]
      const key = step.name
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
        if (isLast && !segmentIsList) return
        node = {}
        current[key] = node
      }

      // If it's an array, find or create the matching args branch
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
        // Convert to array for branching
        const oldNode = node
        const newNode = {__args: args}
        current[key] = [oldNode, newNode]
        node = newNode
      } else if (args === undefined && node.__args !== undefined) {
        // Node has args but we are accessing it without args.
        // Branch it.
        const oldNode = node
        const newNode = {}
        current[key] = [oldNode, newNode]
        node = newNode
      } else if (
        args !== undefined &&
        node.__args === undefined &&
        hasNonMetaKeys(node)
      ) {
        // Node has children but no args, and we now have args?
        // Add args to the existing node
        node.__args = args
      }

      if (segmentIsList) {
        if (typeof node === 'object') {
          node.__isList = true
        } else {
          current[key] = {__isList: true}
          node = current[key]
        }
      }

      if (!isLast) {
        current = node
      }
    }
  }

  interface Scope {
    bindings: Map<string, Path[]>
  }
  const scopes: Scope[] = [{bindings: new Map()}]
  function currentScope() {
    return scopes[scopes.length - 1]
  }

  let branchDepth = 0
  const exportedFunctionReturns = new Map<Node, Path[]>()

  function setBinding(
    identifier: string,
    paths: Path[],
    isDeclaration = false
  ) {
    if (!isDeclaration) {
      // Search for existing binding in scope chain to update it
      for (let i = scopes.length - 1; i >= 0; i--) {
        if (scopes[i].bindings.has(identifier)) {
          if (branchDepth > 0) {
            // Merge paths if inside a conditional branch (phi node behavior)
            const existing = scopes[i].bindings.get(identifier)!
            const combined = [...existing]
            const seen = new Set(combined.map(pathKey))
            for (const p of paths) {
              const pk = pathKey(p)
              if (!seen.has(pk)) {
                seen.add(pk)
                combined.push(p)
              }
            }
            scopes[i].bindings.set(identifier, combined)
          } else {
            // Sequential re-assignment replaces paths
            scopes[i].bindings.set(identifier, paths)
          }
          return
        }
      }
    }
    // If not found in any scope or is a fresh declaration, set in current scope
    currentScope().bindings.set(identifier, paths)
    // Opt C: Track new aliases for pre-filtering
    if (paths.length > 0) trackedNames.add(identifier)
  }

  function resolveBinding(identifier: string): Path[] {
    const paths = (() => {
      for (let i = scopes.length - 1; i >= 0; i--) {
        if (scopes[i].bindings.has(identifier)) {
          return scopes[i].bindings.get(identifier)!
        }
      }
      if (options.rootObjectName && identifier === options.rootObjectName) {
        if (options.rootObjectName === 'data') return [[]]
        return [[{name: options.rootObjectName}]]
      }
      return []
    })()
    return paths
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

  /**
   * Dispatch param binding: identifier → setBinding, binding pattern → handleDestructuring.
   */
  function bindParam(
    paramNameNode: Node,
    paths: Path[],
    isDeclaration = false
  ) {
    if (Node.isIdentifier(paramNameNode)) {
      setBinding(paramNameNode.getText(), paths, isDeclaration)
    } else if (
      Node.isObjectBindingPattern(paramNameNode) ||
      Node.isArrayBindingPattern(paramNameNode)
    ) {
      handleDestructuring(paramNameNode, paths)
    }
  }

  /**
   * Execute a function body (block or expression), returning the paths from return statements.
   * Saves and restores lastReturnedPaths around block bodies.
   */
  function executeFunctionBody(body: Node | undefined): Path[] {
    if (!body) return []
    if (Node.isBlock(body)) {
      const prevReturned = lastReturnedPaths
      lastReturnedPaths = []
      body.getStatements().forEach(analyzeStatement)
      const bodyPaths = lastReturnedPaths
      lastReturnedPaths = prevReturned
      return bodyPaths
    }
    return evaluateExpression(body)
  }

  /**
   * Bind the iterator element parameter for array methods.
   * For `reduce`, the element is the 2nd param; for all others it's the 1st.
   */
  function bindIteratorParam(
    params: any[],
    basePaths: Path[],
    methodName: string
  ) {
    const paramIndex = methodName === 'reduce' ? 1 : 0
    if (params.length > paramIndex) {
      bindParam(params[paramIndex].getNameNode(), basePaths)
    }
  }

  /**
   * Guard against infinite recursion when entering a function/component body.
   * Manages visitedDecls count, currentDepth, and scope push/pop.
   * Returns undefined if the guard blocks (too deep / too many visits);
   * otherwise returns the result of `fn()`.
   */
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

    scopes.push({bindings: new Map()})
    try {
      return fn()
    } finally {
      scopes.pop()
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

  function handleDestructuring(pattern: BindingPattern, paths: Path[]) {
    if (Node.isObjectBindingPattern(pattern)) {
      for (const element of pattern.getElements()) {
        let propName = ''
        const propertyNameNode = element.getPropertyNameNode()
        const nameNode = element.getNameNode()

        // Handle rest operator: const { a, ...rest } = obj;
        if (element.getDotDotDotToken()) {
          if (Node.isIdentifier(nameNode)) {
            setBinding(nameNode.getText(), paths)
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
            setBinding(nameNode.getText(), nextPaths)
          } else if (
            Node.isObjectBindingPattern(nameNode) ||
            Node.isArrayBindingPattern(nameNode)
          ) {
            handleDestructuring(nameNode, nextPaths)
          }
        }
      }
    } else if (Node.isArrayBindingPattern(pattern)) {
      for (const element of pattern.getElements()) {
        if (!Node.isOmittedExpression(element)) {
          const nameNode = element.getNameNode()

          // Handle rest operator: const [a, ...others] = arr;
          if (element.getDotDotDotToken()) {
            if (Node.isIdentifier(nameNode)) {
              setBinding(nameNode.getText(), paths)
            }
            continue
          }

          if (Node.isIdentifier(nameNode)) {
            setBinding(nameNode.getText(), paths)
          } else if (
            Node.isObjectBindingPattern(nameNode) ||
            Node.isArrayBindingPattern(nameNode)
          ) {
            handleDestructuring(nameNode, paths)
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
  const MAX_DEPTH = 5
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
              // Heuristic: If it's a HOC call, the component is likely one of the arguments.
              // We look for the first argument that resolves to a function.
              let foundSubDecl = false
              for (const arg of args) {
                const argSym = getSymbol(arg)
                if (argSym) {
                  const subDecl = resolveFunctionDefinition(
                    argSym,
                    onFileAccess
                  )
                  if (subDecl) {
                    initializer = subDecl as any
                    foundSubDecl = true
                    break
                  }
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
                break // Continue while loop with new symbol
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

  function evaluateExpression(node: Node): Path[] {
    if (!node) return []

    if (options.targetNodes) {
      const idx = options.targetNodes.indexOf(node)
      if (idx !== -1) {
        return [[{name: `__target_${idx}`}]]
      }
    }

    if (Node.isIdentifier(node)) {
      return resolveBinding(node.getText())
    }

    if (Node.isPropertyAccessExpression(node)) {
      const basePaths = evaluateExpression(node.getExpression())
      const name = node.getName()

      // Check for virtual property matches from object returns
      const propPrefix = `__prop_${name}`
      const matchingPaths = basePaths.filter(p => p[0]?.name === propPrefix)
      if (matchingPaths.length > 0) {
        return matchingPaths.map(p => p.slice(1))
      }

      if (JS_INTERNALS.has(name) || (name.startsWith('$') && name !== '$on')) {
        if (JS_ARRAY_METHODS.has(name)) markAsList(basePaths)
        return name === 'bind' ? basePaths : []
      }

      const newPaths: Path[] = []
      for (const path of basePaths) {
        const nextPath = [...path, {name}]
        mergePathAndArgs(result, nextPath)
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
        if (Node.isSpreadElement(el)) {
          paths.push(...evaluateExpression(el.getExpression()))
        } else {
          paths.push(...evaluateExpression(el))
        }
      })
      return paths
    }

    if (Node.isSpreadElement(node)) {
      return evaluateExpression(node.getExpression())
    }

    if (Node.isElementAccessExpression(node)) {
      const basePaths = evaluateExpression(node.getExpression())
      const argExpr = node.getArgumentExpression()
      if (argExpr) evaluateExpression(argExpr)
      markAsList(basePaths)
      return basePaths
    }

    if (Node.isCallExpression(node)) {
      const args = node.getArguments()
      // Lazy: only compute argsString when actually needed (method calls with args)
      let argsString: string | undefined
      const getArgsString = () => {
        if (argsString === undefined) {
          argsString =
            args.length > 0 ? args.map(arg => arg.getText()).join(', ') : ''
        }
        return argsString
      }

      const expr = node.getExpression()

      // Special handling for common React hooks
      const hookName = Node.isIdentifier(expr)
        ? expr.getText()
        : Node.isPropertyAccessExpression(expr)
          ? expr.getName()
          : ''
      if (hookName === 'useMemo' || hookName === 'useCallback') {
        const firstArg = args[0]
        if (
          firstArg &&
          (Node.isArrowFunction(firstArg) ||
            Node.isFunctionExpression(firstArg))
        ) {
          return evaluateExpression(firstArg)
        }
      }

      if (hookName === 'useContext') {
        const firstArg = args[0]
        if (firstArg) {
          const sym = getSymbol(firstArg)
          const decls = sym?.getDeclarations()
          for (const d of decls || []) {
            if (Node.isVariableDeclaration(d)) {
              let init = d.getInitializer()
              while (
                init &&
                (Node.isAsExpression(init) ||
                  Node.isParenthesizedExpression(init))
              ) {
                init = init.getExpression()
              }
              if (init && Node.isCallExpression(init)) {
                const callExpr = init.getExpression()
                const callName = Node.isIdentifier(callExpr)
                  ? callExpr.getText()
                  : Node.isPropertyAccessExpression(callExpr)
                    ? callExpr.getName()
                    : ''
                if (callName === 'createContext') {
                  const defaultVal = init.getArguments()[0]
                  if (defaultVal) return evaluateExpression(defaultVal)
                }
              }
            }
          }
        }
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
              scopes.push({bindings: new Map()})
              bindIteratorParam(arg.getParameters(), basePaths, methodName)
              callbackPaths = executeFunctionBody(arg.getBody())
              scopes.pop()
            } else if (Node.isIdentifier(arg)) {
              // It's a reference to a function, e.g. .map(myFn)
              const fnName = arg.getText()
              let fnDef = functionRegistry.get(fnName)

              if (!fnDef) {
                let symbol: any
                if (needsTypeChecker(arg)) {
                  symbol = getSymbol(arg) || getNodeType(arg).getSymbol()
                }
                fnDef = resolveFunctionDefinition(symbol, options.onFileAccess)
              }
              if (fnDef) {
                const result = withRecursionGuard(fnDef, () => {
                  bindIteratorParam(
                    fnDef.getParameters(),
                    basePaths,
                    methodName
                  )
                  return executeFunctionBody(fnDef.getBody())
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
                  idx === p.length - 1 ? {...s, __isVirtual: true} : s
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

        // Before treating as a GraphQL field call, check if this method
        // resolves to a local function definition (e.g. preview.opener(file))

        // Strategy 1: Check if method name is in the function registry
        let methodFnDef = functionRegistry.get(methodName)

        // Strategy 2: Try to resolve via the property access symbol/type
        if (!methodFnDef) {
          if (needsTypeChecker(expr)) {
            const methodSymbol = getSymbol(expr)
            methodFnDef = resolveFunctionDefinition(
              methodSymbol,
              options.onFileAccess
            )
          }
        }

        // Strategy 3: Check if basePaths have __prop_ entries pointing to
        // function paths — resolve via the property name in the expression
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

        const methodArgsPaths = node
          .getArguments()
          .map(arg => evaluateExpression(arg))

        if (methodFnDef) {
          const retPaths = withRecursionGuard(methodFnDef, () => {
            methodFnDef.getParameters().forEach((param, i) => {
              if (i < methodArgsPaths.length) {
                bindParam(param.getNameNode(), methodArgsPaths[i], true)
              }
            })
            return executeFunctionBody(methodFnDef.getBody())
          })
          if (retPaths) return retPaths
        }

        // Fallthrough: treat as a GraphQL field call with arguments
        const newPaths: Path[] = []
        for (const path of basePaths) {
          const nextPath = [...path, {name: methodName, args: getArgsString()}]
          mergePathAndArgs(result, nextPath)
          newPaths.push(nextPath)
        }
        return newPaths
      }

      if (Node.isIdentifier(expr)) {
        const fnName = expr.getText()
        let fnDef = functionRegistry.get(fnName)

        if (!fnDef) {
          if (needsTypeChecker(expr)) {
            const symbol = getSymbol(expr) || getNodeType(expr).getSymbol()
            fnDef = resolveFunctionDefinition(symbol, options.onFileAccess)
          }
        }

        const argsPaths = node
          .getArguments()
          .map(arg => evaluateExpression(arg))

        if (fnDef) {
          const retPaths = withRecursionGuard(fnDef, () => {
            fnDef.getParameters().forEach((param, i) => {
              if (i < argsPaths.length) {
                bindParam(param.getNameNode(), argsPaths[i], true)
              }
            })
            return executeFunctionBody(fnDef.getBody())
          })
          if (retPaths) return retPaths
        }
      } else {
        evaluateExpression(expr)
      }

      return []
    }

    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
      const tagNameNode = node.getTagNameNode()
      let decl: any

      if (Node.isIdentifier(tagNameNode)) {
        const name = tagNameNode.getText()
        decl = functionRegistry.get(name)
      }

      if (!decl) {
        let symbol: any
        if (needsTypeChecker(tagNameNode)) {
          symbol =
            getSymbol(tagNameNode) || getNodeType(tagNameNode).getSymbol()
        }
        decl = resolveFunctionDefinition(symbol, options.onFileAccess)
      }

      const attributes = node.getAttributes()
      const propsPaths: Map<string, Path[]> = new Map()

      // ALWAYS evaluate attributes, whether it's a custom component or intrinsic HTML
      attributes.forEach(attr => {
        if (Node.isJsxAttribute(attr)) {
          const name = attr.getNameNode().getText()
          const initializer = attr.getInitializer()
          if (initializer && Node.isJsxExpression(initializer)) {
            const expr = initializer.getExpression()
            if (expr) {
              propsPaths.set(name, evaluateExpression(expr))
            }
          }
        }
      })

      if (decl) {
        withRecursionGuard(decl, () => {
          const params = decl.getParameters()
          if (params.length > 0) {
            const propsParam = params[0].getNameNode()
            if (Node.isObjectBindingPattern(propsParam)) {
              for (const element of propsParam.getElements()) {
                const propName =
                  element.getPropertyNameNode()?.getText() || element.getName()
                if (propsPaths.has(propName)) {
                  const paths = propsPaths.get(propName)!
                  bindParam(element.getNameNode(), paths, true)
                }
              }
            } else if (Node.isIdentifier(propsParam)) {
              const allPaths: Path[] = []
              propsPaths.forEach((paths, name) => {
                paths.forEach(p => {
                  allPaths.push([{name: `__prop_${name}`}, ...p])
                })
              })
              setBinding(
                propsParam.getText(),
                allPaths.length > 0 ? allPaths : [[]],
                true
              )
            }
          }

          executeFunctionBody(decl.getBody())
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
      scopes.push({bindings: new Map()})
      const resultPaths = executeFunctionBody(node.getBody())
      scopes.pop()
      return resultPaths
    }

    if (Node.isBinaryExpression(node)) {
      const left = evaluateExpression(node.getLeft())
      const right = evaluateExpression(node.getRight())
      return [...left, ...right]
    }

    // Fallback: evaluate all children for side effects
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
      // Opt C: Skip blocks with many statements that don't mention tracked identifiers
      const stmts = stmt.getStatements()
      if (stmts.length > 5 && !textMentionsTracked(stmt)) return
      scopes.push({bindings: new Map()})
      stmts.forEach(analyzeStatement)
      scopes.pop()
    } else if (Node.isReturnStatement(stmt)) {
      const expr = stmt.getExpression()
      if (expr) {
        lastReturnedPaths = evaluateExpression(expr)

        // Track if an exported function returns our tracked paths
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
      if (options.targetNodes) {
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

    // Opt C: Skip function declarations whose bodies don't mention any tracked identifier
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

export function extractAdvancedSelectors(
  sourceText: string,
  objectName: string = 'data'
): SelectorNode {
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: 4 // ReactJSX
    },
    useInMemoryFileSystem: true
  })
  const sourceFile = project.createSourceFile('temp.tsx', sourceText)
  const {result} = coreAnalyze(sourceFile, {rootObjectName: objectName})

  const clean = (obj: any) => {
    if (typeof obj !== 'object' || obj === null) return
    if (Array.isArray(obj)) {
      obj.forEach(clean)
      return
    }
    for (const key in obj) {
      if (key.startsWith('__prop_')) {
        delete obj[key]
      } else {
        clean(obj[key])
      }
    }
  }
  clean(result)

  return result
}

export function extractQueries(
  filePath: string,
  project: Project,
  options: {
    pylonPackage?: string
    hookName?: string
    skipDependencyResolution?: boolean
  } = {}
): {queries: QueryLocation[]; dependencies: string[]} {
  const accessedFiles = new Set<string>()
  accessedFiles.add(filePath)
  const {pylonPackage = '@getcronit/pylon/pages', hookName = 'useData'} =
    options
  const sourceFile = project.getSourceFileOrThrow(filePath)

  // Opt 3: Only resolve dependencies if not already done by the caller
  if (!options.skipDependencyResolution) {
    project.resolveSourceFileDependencies()
  }

  const targetNodes = findUseQueries(sourceFile, pylonPackage, hookName)
  const {result, exportedFunctionReturns} = coreAnalyze(sourceFile, {
    targetNodes,
    onFileAccess: sf => accessedFiles.add(sf.getFilePath())
  })

  // Second pass: Find project-wide call sites of functions that return hook data (Breadth-First Search)
  const processedCallSites = new Set<Node>()
  const functionQueue: Array<[Node, Path[]]> = Array.from(
    exportedFunctionReturns.entries()
  )
  const processedFunctions = new Set<Node>()

  // Opt A: Build a syntactic import graph lazily to avoid project-wide findReferences()
  let directImporterGraph: Map<string, Set<SourceFile>> | undefined

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
      sf.getImportDeclarations().forEach(imp => {
        const moduleSF = imp.getModuleSpecifierSourceFile()
        if (moduleSF) addToGraph(moduleSF.getFilePath(), sf)
      })
      sf.getExportDeclarations().forEach(exp => {
        const moduleSF = exp.getModuleSpecifierSourceFile()
        if (moduleSF) addToGraph(moduleSF.getFilePath(), sf)
      })
    })
  }

  /** Transitive closure: find all files that eventually import sfPath */
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

  // Opt A: Helper to find call sites of a function in a specific file without TypeChecker
  function findCallSitesInFile(sf: SourceFile, fnName: string): Node[] {
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

  // Opt 2: Memoize findReferences() per function node — avoids O(N²) project scans
  // (In Opt A, we only use this for symbols that aren't easily resolved via import graph,
  // or as a fallback. But primarily we'll use targeted scan.)
  const referencesCache = new Map<Node, any[]>()
  function getCachedReferences(fn: Node): any[] {
    let refs = referencesCache.get(fn)
    if (refs !== undefined) return refs
    refs = ((fn as any).findReferences?.() || []) as any[]
    referencesCache.set(fn, refs)
    return refs
  }

  // Opt 1: Cache coreAnalyze results per (filePath, targetNodeKey)
  const analysisCache = new Map<string, AnalysisResult>()
  function getCachedAnalysis(sf: SourceFile, targets: Node[]): AnalysisResult {
    // Key by file path + target node positions for identity
    const cacheKey =
      sf.getFilePath() +
      ':' +
      targets.map(t => t.getStart() + '-' + t.getEnd()).join(',')
    let cached = analysisCache.get(cacheKey)
    if (cached) return cached
    cached = coreAnalyze(sf, {
      targetNodes: targets,
      onFileAccess: s => accessedFiles.add(s.getFilePath())
    })
    analysisCache.set(cacheKey, cached)
    return cached
  }

  while (functionQueue.length > 0) {
    const [fn, paths] = functionQueue.shift()!
    if (processedFunctions.has(fn)) continue
    processedFunctions.add(fn)

    const targetPaths = paths.filter(p =>
      p.some(step => step.name.startsWith('__target_'))
    )
    if (targetPaths.length === 0) continue

    // Ensure the import graph is built before we start searching for callers
    buildImporterGraph()

    // Opt A: Instead of findReferences(), use our targeted importer graph
    const callNodes: Node[] = []

    if (
      Node.isFunctionDeclaration(fn) ||
      Node.isArrowFunction(fn) ||
      Node.isFunctionExpression(fn)
    ) {
      const name = (fn as any).getName?.()
      const sf = fn.getSourceFile()
      const sfPath = sf.getFilePath()

      // 1. Search in the same file (internal calls)
      if (name) {
        callNodes.push(...findCallSitesInFile(sf, name))
      }

      // 2. Search in all files that (transitively) import this file
      const importers = getTransitiveImporters(sfPath)
      if (importers.size > 0 && name) {
        for (const importer of importers) {
          callNodes.push(...findCallSitesInFile(importer, name))
        }
      }
    }

    // Fallback if targeted scan found nothing but we have paths (e.g. anonymous or complex exports)
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

      // Find the call expression that uses this function
      let call: Node | undefined = node
      while (call && !Node.isCallExpression(call)) {
        call = call.getParent()
      }

      if (call && Node.isCallExpression(call)) {
        accessedFiles.add(call.getSourceFile().getFilePath())
        const callerAnalysis = getCachedAnalysis(call.getSourceFile(), [call])

        // Add any new returning functions discovered in this caller's file to the queue
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
          // Find where __target_ is in the path
          const targetIdx = tp.findIndex(step =>
            step.name.startsWith('__target_')
          )
          if (targetIdx === -1) continue

          const prefixes = tp.slice(0, targetIdx)
          const suffixes = tp.slice(targetIdx + 1)

          // 1. Dive into externalSelectors using prefixes (stripping "__prop_")
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

          // 2. Handle property shadowing: If we are at the top-level spread/return,
          // we must filter out any properties that are explicitly shadowed by the function's return object.
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
            const isLast = i === subPath.length - 1

            if (currentLevel[step.name] === true && !isLast) {
              currentLevel[step.name] = {}
            }

            parent = currentLevel
            lastKey = step.name

            if (isLast) {
              // If it's the last step, we handle it specially based on currentExt
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
                // currentExt is empty object or other, preserve existing leaf if it's true
                if (currentLevel[step.name] === undefined) {
                  currentLevel[step.name] = true
                }
              }
              break
            }

            currentLevel =
              currentLevel[step.name] || (currentLevel[step.name] = {})
          }
          continue // Skip the old merge logic below as we handled it in the loop
        }
      }
    }
  }

  return {
    queries: targetNodes.map((node: any, idx) => ({
      start: node.getStart(),
      end: node.getEnd(),
      selectors: result[`__target_${idx}`] || {},
      node
    })),
    dependencies: Array.from(accessedFiles)
  }
}

function deepMerge(target: any, source: any) {
  if (!source || typeof source !== 'object') return

  for (const key in source) {
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
      // If we are setting a leaf but target[key] is already an object,
      // we don't want to overwrite the object with 'true' (losing selectors).
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
