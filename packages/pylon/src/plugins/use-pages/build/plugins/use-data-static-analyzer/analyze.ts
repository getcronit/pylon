import {
  ArrowFunction,
  BindingPattern,
  FunctionDeclaration,
  FunctionExpression,
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

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null)
    return false
  const keysA = Object.keys(a),
    keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!keysB.includes(key)) return false
    if (!deepEqual(a[key], b[key])) return false
  }
  return true
}

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
        let branch = node.find((n: any) => deepEqual(n.__args, args))
        if (!branch) {
          branch = args !== undefined ? {__args: args} : {}
          node.push(branch)
        }
        node = branch
      } else if (
        args !== undefined &&
        node.__args !== undefined &&
        !deepEqual(node.__args, args)
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
        Object.keys(node).filter(k => k !== '__isList').length > 0
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
            for (const p of paths) {
              if (
                !combined.some(cp => JSON.stringify(cp) === JSON.stringify(p))
              ) {
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

  function extractArgValue(node: Node): string {
    return node.getText()
  }

  const functionRegistry = new Map<
    string,
    FunctionDeclaration | ArrowFunction | FunctionExpression
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
    FunctionDeclaration | ArrowFunction | FunctionExpression,
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
          Node.isFunctionExpression(d)
      )

      if (!decl) {
        const varDecl = decls?.find((d: any) => Node.isVariableDeclaration(d))
        if (varDecl) {
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
                const argSym =
                  arg.getSymbol() || checker.getSymbolAtLocation(arg)
                if (argSym) {
                  const subDecl = resolveFunctionDefinition(argSym, onFileAccess)
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
              const sym =
                initializer.getSymbol() ||
                checker.getSymbolAtLocation(initializer)
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

      const JS_ARRAY_METHODS = new Set([
        'push',
        'pop',
        'shift',
        'unshift',
        'splice',
        'slice',
        'join',
        'concat',
        'indexOf',
        'includes',
        'flat',
        'flatMap'
      ])
      const JS_INTERNALS = new Set([
        ...JS_ARRAY_METHODS,
        'length',
        'toString',
        'valueOf',
        'hasOwnProperty',
        'bind',
        'call',
        'apply'
      ])

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
        } else if (Node.isSpreadAssignment(prop)) {
          const spreadPaths = evaluateExpression(prop.getExpression())
          paths.push(...spreadPaths)
        }
      })
      return paths
    }

    if (Node.isElementAccessExpression(node)) {
      const basePaths = evaluateExpression(node.getExpression())
      const argExpr = node.getArgumentExpression()
      if (argExpr) evaluateExpression(argExpr)
      markAsList(basePaths)
      return basePaths
    }

    if (Node.isCallExpression(node)) {
      let argsString: string | undefined
      const args = node.getArguments()
      if (args.length > 0) {
        argsString = args.map(arg => arg.getText()).join(', ')
      }

      const expr = node.getExpression()
      if (Node.isPropertyAccessExpression(expr)) {
        const methodName = expr.getName()
        const baseExpr = expr.getExpression()

        const basePaths = evaluateExpression(baseExpr)

        if (
          methodName === 'map' ||
          methodName === 'filter' ||
          methodName === 'forEach' ||
          methodName === 'reduce' ||
          methodName === 'some' ||
          methodName === 'every' ||
          methodName === 'find' ||
          methodName === 'findIndex'
        ) {
          markAsList(basePaths)
          let callbackPaths: Path[] = []
          node.getArguments().forEach(originalArg => {
            let arg = originalArg
            while (Node.isParenthesizedExpression(arg)) {
              arg = arg.getExpression() as any
            }
            if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
              scopes.push({bindings: new Map()})

              const params = arg.getParameters()
              if (methodName === 'reduce') {
                if (params.length > 1) {
                  const paramNameNode = params[1].getNameNode()
                  if (Node.isIdentifier(paramNameNode)) {
                    setBinding(paramNameNode.getText(), basePaths)
                  } else if (
                    Node.isObjectBindingPattern(paramNameNode) ||
                    Node.isArrayBindingPattern(paramNameNode)
                  ) {
                    handleDestructuring(paramNameNode, basePaths)
                  }
                }
              } else {
                if (params.length > 0) {
                  const paramNameNode = params[0].getNameNode()
                  if (Node.isIdentifier(paramNameNode)) {
                    setBinding(paramNameNode.getText(), basePaths)
                  } else if (
                    Node.isObjectBindingPattern(paramNameNode) ||
                    Node.isArrayBindingPattern(paramNameNode)
                  ) {
                    handleDestructuring(paramNameNode, basePaths)
                  }
                }
              }

              const body = arg.getBody()
              if (body) {
                if (Node.isBlock(body)) {
                  body.getStatements().forEach(analyzeStatement)
                } else {
                  callbackPaths = evaluateExpression(body)
                }
              }
              scopes.pop()
            } else if (Node.isIdentifier(arg)) {
              // It's a reference to a function, e.g. .map(myFn)
              const symbol = arg.getSymbol() || arg.getType().getSymbol()
              const fnDef = resolveFunctionDefinition(symbol, options.onFileAccess)
              if (fnDef) {
                const count = visitedDecls.get(fnDef) || 0
                if (
                  count < MAX_RECURSION_PER_DECL &&
                  currentDepth < MAX_DEPTH
                ) {
                  visitedDecls.set(fnDef, count + 1)
                  currentDepth++
                  scopes.push({bindings: new Map()})

                  const params = fnDef.getParameters()
                  if (methodName === 'reduce') {
                    if (params.length > 1) {
                      const paramNameNode = params[1].getNameNode()
                      if (Node.isIdentifier(paramNameNode)) {
                        setBinding(paramNameNode.getText(), basePaths)
                      }
                    }
                  } else {
                    if (params.length > 0) {
                      const paramNameNode = params[0].getNameNode()
                      if (Node.isIdentifier(paramNameNode)) {
                        setBinding(paramNameNode.getText(), basePaths)
                      }
                    }
                  }

                  const body = fnDef.getBody()
                  if (body) {
                    if (Node.isBlock(body)) {
                      body.getStatements().forEach(analyzeStatement)
                    } else {
                      callbackPaths = evaluateExpression(body)
                    }
                  }

                  scopes.pop()
                  currentDepth--
                  const newCount = (visitedDecls.get(fnDef) || 1) - 1
                  if (newCount <= 0) visitedDecls.delete(fnDef)
                  else visitedDecls.set(fnDef, newCount)
                }
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

        const JS_ARRAY_METHODS = new Set([
          'push',
          'pop',
          'shift',
          'unshift',
          'splice',
          'slice',
          'join',
          'concat',
          'indexOf',
          'includes',
          'flat',
          'flatMap'
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
          'toFixed',
          'toPrecision',
          'toExponential',
          'bind',
          'call',
          'apply'
        ])

        if (JS_INTERNALS.has(methodName) || methodName.startsWith('$')) {
          if (JS_ARRAY_METHODS.has(methodName)) markAsList(basePaths)
          node.getArguments().forEach(arg => evaluateExpression(arg))
          return methodName === 'bind' ? basePaths : []
        }

        node.getArguments().forEach(arg => evaluateExpression(arg))

        const newPaths: Path[] = []
        for (const path of basePaths) {
          const args = argsString !== undefined ? argsString : ''
          const nextPath = [...path, {name: methodName, args}]
          mergePathAndArgs(result, nextPath)
          newPaths.push(nextPath)
        }
        return newPaths
      }

      if (Node.isIdentifier(expr)) {
        const fnName = expr.getText()
        let fnDef = functionRegistry.get(fnName)

        if (!fnDef) {
          const symbol = expr.getSymbol() || expr.getType().getSymbol()
          fnDef = resolveFunctionDefinition(symbol, options.onFileAccess)
        }

        const argsPaths = node
          .getArguments()
          .map(arg => evaluateExpression(arg))

        const count = (fnDef && visitedDecls.get(fnDef)) || 0
        if (
          fnDef &&
          count < MAX_RECURSION_PER_DECL &&
          currentDepth < MAX_DEPTH
        ) {
          visitedDecls.set(fnDef, count + 1)
          currentDepth++
          const sourceFile = fnDef.getSourceFile()
          if (options.onFileAccess) options.onFileAccess(sourceFile)

          scopes.push({bindings: new Map()})

          fnDef.getParameters().forEach((param, i) => {
            if (i < argsPaths.length) {
              const paramNameNode = param.getNameNode()
              if (Node.isIdentifier(paramNameNode)) {
                setBinding(paramNameNode.getText(), argsPaths[i], true)
              } else if (
                Node.isObjectBindingPattern(paramNameNode) ||
                Node.isArrayBindingPattern(paramNameNode)
              ) {
                handleDestructuring(paramNameNode, argsPaths[i])
              }
            }
          })

          let currentRetPaths: Path[] = []
          const body = fnDef.getBody()
          if (body) {
            if (Node.isBlock(body)) {
              const prevReturned = lastReturnedPaths
              lastReturnedPaths = []
              body.getStatements().forEach(analyzeStatement)
              currentRetPaths = lastReturnedPaths
              lastReturnedPaths = prevReturned
            } else {
              currentRetPaths = evaluateExpression(body)
            }
          }

          scopes.pop()
          currentDepth--
          const newCount = (visitedDecls.get(fnDef) || 1) - 1
          if (newCount <= 0) visitedDecls.delete(fnDef)
          else visitedDecls.set(fnDef, newCount)
          return currentRetPaths
        }
      } else {
        evaluateExpression(expr)
      }

      return []
    }

    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
      const tagName = node.getTagNameNode()
      const symbol = tagName.getSymbol() || tagName.getType().getSymbol()
      const decl = resolveFunctionDefinition(symbol, options.onFileAccess)

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
        const count = visitedDecls.get(decl) || 0
        if (count < MAX_RECURSION_PER_DECL && currentDepth < MAX_DEPTH) {
          visitedDecls.set(decl, count + 1)
          currentDepth++
          const sourceFile = decl.getSourceFile()
          if (options.onFileAccess) options.onFileAccess(sourceFile)

          scopes.push({bindings: new Map()})
          const params = decl.getParameters()
          if (params.length > 0) {
            const propsParam = params[0].getNameNode()
            if (Node.isObjectBindingPattern(propsParam)) {
              for (const element of propsParam.getElements()) {
                const propName =
                  element.getPropertyNameNode()?.getText() || element.getName()
                if (propsPaths.has(propName)) {
                  const paths = propsPaths.get(propName)!
                  const nameNode = element.getNameNode()
                  if (Node.isIdentifier(nameNode)) {
                    setBinding(nameNode.getText(), paths, true)
                  } else if (
                    Node.isObjectBindingPattern(nameNode) ||
                    Node.isArrayBindingPattern(nameNode)
                  ) {
                    handleDestructuring(nameNode, paths)
                  }
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

          const body = decl.getBody()
          if (body) {
            if (Node.isBlock(body)) {
              body.getStatements().forEach(analyzeStatement)
            } else {
              evaluateExpression(body)
            }
          }
          scopes.pop()
          currentDepth--
          const newCount = (visitedDecls.get(decl) || 1) - 1
          if (newCount <= 0) visitedDecls.delete(decl)
          else visitedDecls.set(decl, newCount)
        }
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

    if (
      options.targetNodes &&
      (Node.isArrowFunction(node) || Node.isFunctionExpression(node))
    ) {
      scopes.push({bindings: new Map()})
      const body = node.getBody()
      if (body) {
        if (Node.isBlock(body)) {
          body.getStatements().forEach(analyzeStatement)
        } else {
          evaluateExpression(body)
        }
      }
      scopes.pop()
    }

    let childrenPaths: Path[] = []
    node.forEachChild(child => {
      const p = evaluateExpression(child)
      childrenPaths = [...childrenPaths, ...p]
    })

    return []
  }

  function analyzeStatement(stmt: Node) {
    if (Node.isVariableStatement(stmt)) {
      for (const decl of stmt.getDeclarations()) {
        const initializer = decl.getInitializer()
        const paths = initializer ? evaluateExpression(initializer) : []
        const nameNode = decl.getNameNode()
        if (Node.isIdentifier(nameNode)) {
          setBinding(nameNode.getText(), paths, true)
        } else if (
          Node.isObjectBindingPattern(nameNode) ||
          Node.isArrayBindingPattern(nameNode)
        ) {
          handleDestructuring(nameNode, paths)
        }
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
            const nameNode = decl.getNameNode()
            if (Node.isIdentifier(nameNode))
              setBinding(nameNode.getText(), paths)
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
          const nameNode = decl.getNameNode()
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
      analyzeStatement(stmt.getStatement())
      scopes.pop()
    } else if (Node.isBlock(stmt)) {
      scopes.push({bindings: new Map()})
      stmt.getStatements().forEach(analyzeStatement)
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
        const body = stmt.getBody()
        if (body) {
          scopes.push({bindings: new Map()})
          if (Node.isBlock(body)) {
            body.getStatements().forEach(analyzeStatement)
          } else {
            evaluateExpression(body)
          }
          scopes.pop()
        }
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
              const nameNode = el.getNameNode()
              if (Node.isObjectBindingPattern(nameNode)) {
                handleDestructuring(nameNode, [[]])
              } else if (Node.isIdentifier(nameNode)) {
                setBinding(nameNode.getText(), [[]])
              }
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
  return result
}

export function extractQueries(
  filePath: string,
  project: Project,
  options: {pylonPackage?: string; hookName?: string} = {}
): {queries: QueryLocation[]; dependencies: string[]} {
  const accessedFiles = new Set<string>()
  accessedFiles.add(filePath)
  const {pylonPackage = '@getcronit/pylon/pages', hookName = 'useData'} =
    options
  const sourceFile = project.getSourceFileOrThrow(filePath)

  // Ensure dependencies are resolved if not already
  project.resolveSourceFileDependencies()

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

  while (functionQueue.length > 0) {
    const [fn, paths] = functionQueue.shift()!
    if (processedFunctions.has(fn)) continue
    processedFunctions.add(fn)

    const targetPaths = paths.filter(p =>
      p.some(step => step.name.startsWith('__target_'))
    )
    if (targetPaths.length === 0) continue

    const references = (fn as any).findReferences?.() || []
    for (const refSymbol of references) {
      for (const match of refSymbol.getReferences()) {
        const node = match.getNode()
        if (processedCallSites.has(node)) continue
        processedCallSites.add(node)

        // Find the call expression that uses this function
        let call: Node | undefined = node
        while (call && !Node.isCallExpression(call)) {
          call = call.getParent()
        }

        if (call && Node.isCallExpression(call)) {
          accessedFiles.add(call.getSourceFile().getFilePath())
          const callerAnalysis = coreAnalyze(call.getSourceFile(), {
            targetNodes: [call],
            onFileAccess: sf => accessedFiles.add(sf.getFilePath())
          })

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

            let currentLevel: any =
              result[targetKey] || (result[targetKey] = {})
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
