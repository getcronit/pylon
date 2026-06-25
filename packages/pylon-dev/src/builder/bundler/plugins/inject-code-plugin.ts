import {Plugin} from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import {buildSchema, validateSchema} from 'graphql'
import {updateFileIfChanged} from '../../update-file-if-changed'

/**
 * Pylon must NEVER emit an invalid schema. Validate the generated SDL exactly the
 * way the runtime will (build a schema, run graphql's schema validation) and throw
 * if it's invalid — so the build fails LOUDLY instead of writing a broken
 * schema.graphql that only crashes later at serve time (`assertValidSchema`).
 */
function assertSchemaIsValid(typeDefs: string) {
  let errors: readonly {message: string}[]
  try {
    errors = validateSchema(buildSchema(typeDefs))
  } catch (err) {
    // buildSchema / SDL-level validation itself threw — surface it as the error.
    errors = [err instanceof Error ? err : {message: String(err)}]
  }

  if (errors.length > 0) {
    throw new Error(
      'Pylon generated an invalid GraphQL schema:\n' +
        errors.map(e => `  • ${e.message}`).join('\n') +
        '\n\nThis usually means a resolver return type cannot form a valid schema on ' +
        'its own (e.g. an interface member missing a field, often from an ambiguous ' +
        'inferred type). Fixes: give the resolver an explicit return-type annotation; ' +
        "and for a polymorphic delegate, mark each patch branch's `__typename` `as " +
        'const` so the variants are distinguishable.'
    )
  }
}

export interface InjectCodePluginOptions {
  getBuildDefs: () => {
    typeDefs: string
    resolvers: Record<
      string,
      {
        __resolveType?: (obj: any) => string
      }
    >
  }
  outputDir: string
}

export const injectCodePlugin = ({
  getBuildDefs,
  outputDir
}: InjectCodePluginOptions): Plugin => ({
  name: 'inject-code',
  setup(build) {
    build.onLoad(
      {filter: /src[\/\\]index\.ts$/, namespace: 'file'},
      async args => {
        // Convert to relative path to ensure we match `src/index.ts` at root
        const relativePath = path.relative(process.cwd(), args.path)

        if (relativePath !== path.join('src', 'index.ts')) {
          return
        }

        const {typeDefs, resolvers} = getBuildDefs()

        // Fail the build before writing a single byte if the schema is invalid.
        assertSchemaIsValid(typeDefs)

        const preparedResolvers = prepareObjectInjection(resolvers)

        const contents = await fs.readFile(args.path, 'utf-8')

        // Write the typeDefs to a file
        const typeDefsPath = path.join(
          process.cwd(),
          outputDir,
          'schema.graphql'
        )

        await updateFileIfChanged(typeDefsPath, typeDefs)

        // Write base resolvers to a file

        const resolversPath = path.join(
          process.cwd(),
          outputDir,
          'resolvers.js'
        )

        await updateFileIfChanged(
          resolversPath,
          `export const resolvers = ${preparedResolvers}`
        )

        // Breaking contract: the entry MUST `export default` the Pylon app. We
        // rewrite that default export into a binding (`__pylonApp`) so the
        // generated bootstrap can drive the instance: configure it, mount the
        // GraphQL handler, then serve it.
        if (!/export\s+default\s+/.test(contents)) {
          throw new Error(
            `Pylon entry "${relativePath}" must \`export default\` the app ` +
              `(e.g. \`export default new Pylon(...)\`).`
          )
        }
        const userModule = contents.replace(
          /export\s+default\s+/,
          'const __pylonApp = '
        )

        // Constructor-only registration: the entry's `export default new Pylon({db:
        // {models}, queues})` (and every app it composes) registers all models/queues
        // when the bundled entry module loads — so there's nothing to discover/inject.
        return {
          loader: 'ts',
          contents:
            `import {executeConfig as __pylonExecuteConfig, handler as __pylonHandler} from "@getcronit/pylon"

            // config.js is always emitted (empty {} when there's no pylon.config),
            // so a failure here means the config EXISTS but threw at load — abort
            // boot LOUDLY instead of starting with NO plugins (no db/auth/app/pages),
            // which would silently run the app unsecured.
            var __internalPylonConfig
            try {
              __internalPylonConfig = await import('./config.js')
            } catch (e) {
              console.error("[Pylon] Failed to load pylon.config — refusing to boot (the app would otherwise run with NO plugins).")
              throw e
            }

` +
            userModule +
            `
  // Boot the user's default-exported Pylon: 'first' plugins -> GraphQL handler ->
  // 'last' plugins. SERVING IS NOT THE FRAMEWORK'S JOB — the consuming app owns it
  // via a 'last'-strategy plugin in pylon.config that calls a server (e.g.
  // @hono/node-server's serve). Because that plugin runs in this final 'last' pass
  // — after the GraphQL handler and every other 'last' plugin (usePages catch-all)
  // — it listens only once all routes are registered, so the "matcher already
  // built" boot race can't happen (provided serve is ordered last among 'last').

  // Expose the booted app so in-process callers (e.g. the usePages SSR GraphQL
  // fetcher) hit THIS instance — the one with the handler + plugins mounted —
  // not the framework's empty default 'app' singleton.
  globalThis.__PYLON_APP__ = __pylonApp

  await __pylonExecuteConfig(__internalPylonConfig.config, undefined, __pylonApp)

  __pylonApp.use(__pylonHandler({
    typeDefs: ${JSON.stringify(typeDefs)},
    graphql: __pylonApp.graphql,
    resolvers: ${preparedResolvers},
  }, __pylonApp))

  await __pylonExecuteConfig(__internalPylonConfig.config, {
    pluginsStrategy: "last"
  }, __pylonApp)
  `
        }
      }
    )
  }
})

function prepareObjectInjection(obj: object) {
  const entries = Object.entries(obj).map(([key, value]) => {
    if (value === undefined) {
      return undefined
    } else if (typeof value === 'string') {
      return `${key}:${value}`
    } else if (typeof value === 'function') {
      return `${key}:${value.toString()}`
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      return `${key}:${prepareObjectInjection(value)}`
    } else {
      return `${key}:${JSON.stringify(value)}`
    }
  })

  return `{${entries.join(',')}}`
}
