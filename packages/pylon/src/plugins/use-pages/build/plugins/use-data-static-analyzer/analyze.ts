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
}

function coreAnalyze(sourceFile: SourceFile, options: AnalyzeOptions) {
  const result: Record<string, SelectorNode> = {}

  function mergePathAndArgs(
    tree: Record<string, SelectorNode>,
    path: Path,
    isList: boolean = false
  ) {
    if (path.length === 0) return
    let current: any = tree

    for (let i = 0; i < path.length; i++) {
      const {name: key, args} = path[i]
      const isLast = i === path.length - 1
      // console.log(`Merging ${key} (args: ${args}), isLast: ${isLast}`);

      // Ensure current[key] can hold properties if we are not at the leaf
      if (current[key] === true && !isLast) {
        current[key] = {}
      }

      if (current[key] === undefined || current[key] === true) {
        if (args) {
          const newNode: any = {__args: args}
          if (isLast && isList) newNode.__isList = true
          current[key] = newNode
          current = newNode
        } else {
          if (isLast) {
            if (isList) {
              current[key] = {__isList: true}
              current = current[key]
            } else {
              current[key] = true
            }
          } else {
            current[key] = {}
            current = current[key]
          }
        }
      } else {
        let targetNode: any
        if (Array.isArray(current[key])) {
          targetNode = current[key].find((n: any) => deepEqual(n.__args, args))
          if (!targetNode) {
            targetNode = args ? {__args: args} : {}
            current[key].push(targetNode)
          }
        } else {
          if (args) {
            if (deepEqual(current[key].__args, args)) {
              targetNode = current[key]
            } else {
              const oldNode = current[key]
              targetNode = {__args: args}
              current[key] = [oldNode, targetNode]
            }
          } else {
            if (current[key].__args) {
              const oldNode = current[key]
              targetNode = {}
              current[key] = [oldNode, targetNode]
            } else {
              targetNode = current[key]
            }
          }
        }

        // Handle case where targetNode was a boolean leaf but we need to go deeper
        if (targetNode === true && !isLast) {
          // If it was in an array, we find its index and update it
          if (Array.isArray(current[key])) {
            const idx = current[key].indexOf(targetNode)
            if (idx !== -1) {
              current[key][idx] = {}
              targetNode = current[key][idx]
            }
          } else {
            current[key] = {}
            targetNode = current[key]
          }
        }

        if (isLast && isList && targetNode === true) {
          if (Array.isArray(current[key])) {
            const idx = current[key].indexOf(true)
            if (idx !== -1) {
              current[key][idx] = {__isList: true}
              targetNode = current[key][idx]
            }
          } else {
            current[key] = {__isList: true}
            targetNode = current[key]
          }
        } else if (
          isLast &&
          isList &&
          targetNode &&
          typeof targetNode === 'object'
        ) {
          targetNode.__isList = true
        }

        current = targetNode
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
    // console.log(`Setting binding for ${identifier}:`, paths);
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
    // console.log(`Resolved binding for ${identifier}:`, paths);
    return paths
  }

  let lastReturnedPaths: Path[] = []

  function markAsList(paths: Path[]) {
    paths.forEach(path => {
      mergePathAndArgs(result, path, true)
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
          const nextPaths = paths.map(p => [...p, {name: propName}])
          if (propName.startsWith('$') && propName !== '$on') continue

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
          node.getArguments().forEach(arg => {
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
                  evaluateExpression(body)
                }
              }
              scopes.pop()
            } else {
              evaluateExpression(arg)
            }
          })
          return basePaths
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
          const args = argsString ? argsString : undefined
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
          // Try to resolve from imports/symbols
          const symbol = expr.getSymbol() || expr.getType().getSymbol()
          if (symbol) {
            let decls = symbol.getDeclarations()
            fnDef = decls.find(
              d =>
                Node.isFunctionDeclaration(d) ||
                Node.isArrowFunction(d) ||
                Node.isFunctionExpression(d)
            ) as any

            if (!fnDef) {
              try {
                const aliased = symbol.getAliasedSymbol()
                if (aliased) {
                  const aliasedDecls = aliased.getDeclarations()
                  fnDef = aliasedDecls.find(
                    d =>
                      Node.isFunctionDeclaration(d) ||
                      Node.isArrowFunction(d) ||
                      Node.isFunctionExpression(d)
                  ) as any
                }
              } catch (e) {}
            }
          }
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

      let decl
      if (symbol) {
        let decls = symbol.getDeclarations()
        decl = decls.find(
          d =>
            Node.isFunctionDeclaration(d) ||
            Node.isArrowFunction(d) ||
            Node.isFunctionExpression(d)
        )

        if (!decl) {
          try {
            const aliased = symbol.getAliasedSymbol()
            if (aliased) {
              const aliasedDecls = aliased.getDeclarations()
              decl = aliasedDecls.find(
                d =>
                  Node.isFunctionDeclaration(d) ||
                  Node.isArrowFunction(d) ||
                  Node.isFunctionExpression(d)
              )
            }
          } catch (e) {
            // Some symbols might not be aliases despite being imports
          }
        }
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
        const count = visitedDecls.get(decl) || 0
        if (count < MAX_RECURSION_PER_DECL && currentDepth < MAX_DEPTH) {
          visitedDecls.set(decl, count + 1)
          currentDepth++

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
              setBinding(propsParam.getText(), [[]])
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
): QueryLocation[] {
  const {pylonPackage = '@getcronit/pylon/pages', hookName = 'useData'} =
    options
  const sourceFile = project.getSourceFileOrThrow(filePath)

  // Ensure dependencies are resolved if not already
  project.resolveSourceFileDependencies()

  const targetNodes = findUseQueries(sourceFile, pylonPackage, hookName)
  const {result, exportedFunctionReturns} = coreAnalyze(sourceFile, {
    targetNodes
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
          const callerAnalysis = coreAnalyze(call.getSourceFile(), {
            targetNodes: [call]
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

            for (const step of subPath) {
              if (currentLevel[step.name] === true) {
                currentLevel[step.name] = {}
              }
              parent = currentLevel
              lastKey = step.name
              currentLevel =
                currentLevel[step.name] || (currentLevel[step.name] = {})
            }

            // Deeply merge the transposed selectors
            if (currentExt === true) {
              // If it's used as a primitive externally, ensure it's at least 'true' internally
              // Only if it's currently empty (don't downgrade objects) and not a root marker
              if (
                Object.keys(currentLevel).length === 0 &&
                !lastKey.startsWith('__target_')
              ) {
                parent[lastKey] = true
              }
            } else if (typeof currentExt === 'object') {
              deepMerge(currentLevel, currentExt)
            }
          }
        }
      }
    }
  }

  return targetNodes.map((node: any, idx) => ({
    start: node.getStart(),
    end: node.getEnd(),
    selectors: result[`__target_${idx}`] || {},
    node
  }))
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
