import {Plugin} from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import {updateFileIfChanged} from '../../update-file-if-changed'

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

        return {
          loader: 'ts',
          contents:
            `import {executeConfig as __pylonExecuteConfig, handler as __pylonHandler} from "@getcronit/pylon"
            import {serve as __pylonServe} from "@hono/node-server"

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
  // 'last' plugins, THEN serve. Serving LAST (after every route is registered)
  // makes the "matcher already built" boot race structurally impossible — no
  // readiness latch needed. (Node/Bun dev+run serving via @hono/node-server;
  // target-aware serving is the serve-as-plugin follow-up.)
  await __pylonExecuteConfig(__internalPylonConfig.config, undefined, __pylonApp)

  __pylonApp.use(__pylonHandler({
    typeDefs: ${JSON.stringify(typeDefs)},
    graphql: __pylonApp.graphql,
    resolvers: ${preparedResolvers},
  }, __pylonApp))

  await __pylonExecuteConfig(__internalPylonConfig.config, {
    pluginsStrategy: "last"
  }, __pylonApp)

  __pylonServe(
    {fetch: __pylonApp.fetch, port: Number(process.env.PORT) || 3000},
    info => { console.log("ready:" + info.port) }
  )
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
