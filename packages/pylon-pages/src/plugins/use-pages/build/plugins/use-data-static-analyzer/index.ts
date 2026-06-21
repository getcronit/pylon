import {Plugin} from 'esbuild'
import * as fs from 'fs'
import {buildSchema, GraphQLSchema} from 'graphql'
import path from 'path'
import {Node, SyntaxKind} from 'ts-morph'
import {clearAnalyzeCache, extractQueries, type QueryLocation} from './analyze'
import {StaticAnalysisManager} from './manager'
import {lowerQuery} from './selectors-to-document'
import {generatePrepare} from './selectors-to-prepare'

const DOC_IMPORT = `import { doc as __pylonDoc } from '@getcronit/pylon-query';\n`

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
  /** GraphQL scalar name → TS type, forwarded to the document compiler. */
  scalarTypes?: Record<string, string>
}

export function useDataStaticAnalyzer(
  options: UseDataStaticAnalyzerOptions = {}
): Plugin {
  const {
    filter = /\.(ts|tsx)$/,
    pylonPackage = '@getcronit/pylon-pages',
    hookName = 'useData',
    paginatedHookName = 'usePaginatedData',
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

  return {
    name: 'pylon-use-data-static-analyzer',
    async setup(build) {
      // Resolve the schema once per build session (re-read on each build start
      // so dev-loop schema changes are picked up).
      let schema: GraphQLSchema | undefined = loadSchema()
      const manager =
        options.manager ||
        new StaticAnalysisManager({
          tsConfigFilePath: build.initialOptions.tsconfig
        })
      const project = manager.getProject()

      build.onStart(() => {
        manager.resetSession()
        clearAnalyzeCache() // Flushes internal analyze memoization
        // Re-read the schema each build so dev-loop schema changes take effect.
        schema = loadSchema()
      })

      const entries = build.initialOptions.entryPoints
      if (entries) {
        const entryPaths: string[] = []
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            entryPaths.push(
              typeof entry === 'string' ? entry : (entry as any).in
            )
          }
        } else if (entries && typeof entries === 'object') {
          for (const key in entries) {
            entryPaths.push((entries as any)[key])
          }
        }

        if (entryPaths.length > 0) {
          project.addSourceFilesAtPaths(entryPaths)
          // We can leave this, but the TS compiler will only parse when asked now.
          project.resolveSourceFileDependencies()
        }
      }

      build.onLoad({filter}, async args => {
        const contents = await fs.promises.readFile(args.path, 'utf8')

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
              query: QueryLocation
              connection?: {path: string[]}
              constName: string
              index: number
              decl?: string
            }
            const items: Item[] = []
            queries.forEach(q => items.push({query: q, constName: '', index: 0}))

            let allDeps = dependencies
            if (contents.includes(paginatedHookName)) {
              const paged = extractQueries(args.path, project, {
                pylonPackage,
                hookName: paginatedHookName,
                skipDependencyResolution: true
              })
              paged.queries.forEach(q =>
                items.push({
                  query: q,
                  connection: inferConnectionPath(q.selectors),
                  constName: '',
                  index: 0
                })
              )
              allDeps = Array.from(new Set([...dependencies, ...paged.dependencies]))
            }

            if (items.length > 0) {
              // Stable numbering by source order.
              const ordered = [...items].sort(
                (a, b) => a.query.start - b.query.start
              )
              ordered.forEach((it, i) => {
                it.index = i
                it.constName = `__pylonDoc_${base}_${i}`
              })

              // Apply call rewrites descending so positions stay valid.
              const desc = [...items].sort((a, b) => b.query.start - a.query.start)
              for (const it of desc) {
                try {
                  const lowered = lowerQuery(
                    schema,
                    it.query.selectors,
                    `${base}_${it.index}`,
                    it.constName,
                    {
                      scalarTypes: options.scalarTypes,
                      connection: it.connection,
                      docFnName: '__pylonDoc'
                    }
                  )
                  it.decl = lowered.docDeclaration
                  outputContents = rewriteCall(
                    outputContents,
                    it.query.node,
                    it.constName,
                    lowered.variablesThunk
                  )
                } catch (e: any) {
                  buildErrors.push({
                    text: `useData(): ${e?.message ?? e}`,
                    location: {
                      file: args.path,
                      line: it.query.node.getStartLineNumber()
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
      })
    }
  }
}
