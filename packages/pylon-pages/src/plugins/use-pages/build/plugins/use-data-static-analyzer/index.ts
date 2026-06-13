import {Plugin} from 'esbuild'
import * as fs from 'fs'
import {Node, SyntaxKind} from 'ts-morph'
import {clearAnalyzeCache, extractQueries} from './analyze'
import {StaticAnalysisManager} from './manager'
import {generatePrepare} from './selectors-to-prepare'

export interface UseDataStaticAnalyzerOptions {
  filter?: RegExp
  pylonPackage?: string
  hookName?: string
  debug?: boolean
  manager?: StaticAnalysisManager
}

export function useDataStaticAnalyzer(
  options: UseDataStaticAnalyzerOptions = {}
): Plugin {
  const {
    filter = /\.(ts|tsx)$/,
    pylonPackage = '@getcronit/pylon-pages',
    hookName = 'useData',
    debug = false
  } = options

  return {
    name: 'pylon-use-data-static-analyzer',
    async setup(build) {
      const manager =
        options.manager ||
        new StaticAnalysisManager({
          tsConfigFilePath: build.initialOptions.tsconfig
        })
      const project = manager.getProject()

      build.onStart(() => {
        manager.resetSession()
        clearAnalyzeCache() // Flushes internal analyze memoization
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

          if (queries.length > 0) {
            // OPTIMIZATION: Sort descending so string slice replacements don't offset index paths
            const sortedQueries = [...queries].sort((a, b) => b.start - a.start)

            for (const query of sortedQueries) {
              const node = query.node
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
            watchFiles: dependencies
          }
        } catch (err) {
          console.error(`[Pylon] Error analyzing ${args.path}:`, err)
          return null
        }
      })
    }
  }
}
