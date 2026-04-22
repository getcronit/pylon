import {Plugin} from 'esbuild'
import * as fs from 'fs'
import {extractQueries} from './analyze'
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
   * Optional existing ts-morph Project instance.
   */
  project?: any // Avoiding direct dependency in type if possible
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
      const {Project} = await import('ts-morph')
      const project =
        options.project ||
        new Project({
          compilerOptions: {
            allowJs: true,
            jsx: 4, // ReactJSX
            moduleResolution: 2, // Node
            esModuleInterop: true,
            target: 9 // ESNext
          }
        })

      // Pre-populate the project with the build entry points.
      // ts-morph will automatically resolve all imported dependencies,
      // building a complete graph of the code being bundled.
      if (!options.project) {
        const entries = build.initialOptions.entryPoints
        const entryPaths: string[] = []

        if (Array.isArray(entries)) {
          for (const entry of entries) {
            entryPaths.push(typeof entry === 'string' ? entry : entry.in)
          }
        } else if (entries && typeof entries === 'object') {
          for (const key in entries) {
            entryPaths.push((entries as any)[key])
          }
        }

        if (entryPaths.length > 0) {
          project.addSourceFilesAtPaths(entryPaths)
          project.resolveSourceFileDependencies()
          if (debug) {
            console.log(
              `[Pylon] Setup complete. Project has ${project.getSourceFiles().length} files.`
            )
          }
        }
      }

      build.onLoad({filter}, async args => {
        let contents = await fs.promises.readFile(args.path, 'utf8')

        // Synchronize memory contents with ts-morph for EVERY file esbuild touches.
        // This ensures ts-morph has all potential callers/consumers in memory
        // for accurate project-wide reference tracking.
        project.createSourceFile(args.path, contents, {
          overwrite: true
        })

        // High-speed pre-flight check: skip expensive AST parsing and
        // dependency resolution if the file doesn't look like a Pylon consumer.
        if (
          !contents.includes(pylonPackage) ||
          (!contents.includes(hookName) && !contents.includes('from'))
        ) {
          return null
        }

        if (debug) {
          console.log(`[Pylon] Analyzing ${args.path}`)
        }

        try {
          const queries = extractQueries(args.path, project, {
            pylonPackage,
            hookName
          })

          if (queries.length > 0) {
            const {Node} = await import('ts-morph')

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

            contents = project.getSourceFileOrThrow(args.path).getFullText()

            if (debug) {
              console.log(
                `[Pylon] Effectively injected selectors into ${queries.length} calls in ${args.path}`
              )
            }
          }

          const loader = args.path.endsWith('.tsx') ? 'tsx' : 'ts'
          return {
            contents,
            loader
          }
        } catch (err) {
          console.error(`[Pylon] Error analyzing ${args.path}:`, err)
          return null
        }
      })
    }
  }
}
