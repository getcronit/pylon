import {Plugin} from 'esbuild'
import * as fs from 'fs'
import {Node} from 'ts-morph'
import {extractQueries} from './analyze'
import {StaticAnalysisManager} from './manager'
import {generatePrepare} from './selectors-to-prepare'

export interface UseDataStaticAnalyzerOptions {
  /**
   * Filter for files to process.
   * @default /\.(ts|tsx)$/
   */
  filter?: RegExp
  /**
   * The package name to check for Pylon imports.
   * @default "@getcronit/pylon/pages"
   */
  pylonPackage?: string
  /**
   * The name of the hook to track.
   * @default "useData"
   */
  hookName?: string
  /**
   * Enable debug logging.
   * @default false
   */
  debug?: boolean
  /**
   * Optional existing StaticAnalysisManager instance.
   */
  manager?: StaticAnalysisManager
}

export function useDataStaticAnalyzer(
  options: UseDataStaticAnalyzerOptions = {}
): Plugin {
  const {
    filter = /\.(ts|tsx)$/,
    pylonPackage = '@getcronit/pylon/pages',
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
      })

      // Pre-populate the project with the build entry points if provided.
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
          project.resolveSourceFileDependencies()
        }
      }

      build.onLoad({filter}, async args => {
        const contents = await fs.promises.readFile(args.path, 'utf8')

        // Check cache first
        const cached = manager.getCachedResult(args.path, contents)
        if (cached) {
          return {
            contents: cached.contents,
            loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
            watchFiles: cached.dependencies
          }
        }

        // High-speed pre-flight check
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
            for (const query of queries) {
              const node = query.node
              const args = node.getArguments()
              const prepareFn = generatePrepare(query.selectors)

              if (args.length === 0) {
                node.addArgument(`{ prepare: ${prepareFn} }`)
              } else {
                const firstArg = args[0]
                if (Node.isObjectLiteralExpression(firstArg)) {
                  firstArg.addPropertyAssignment({
                    name: 'prepare',
                    initializer: prepareFn
                  })
                } else {
                  const existing = firstArg.getText()
                  firstArg.replaceWithText(
                    `{ ...${existing}, prepare: ${prepareFn} }`
                  )
                }
              }
            }

            outputContents = project
              .getSourceFileOrThrow(args.path)
              .getFullText()

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
