import {GraphQLScalarType, Kind} from 'graphql'
import {
  DateTimeISOResolver,
  GraphQLVoid,
  JSONObjectResolver,
  JSONResolver
} from 'graphql-scalars'
import {createSchema, createYoga} from 'graphql-yoga'

import {useDisableIntrospection} from '@graphql-yoga/plugin-disable-introspection'
import {readFileSync} from 'fs'
import {MiddlewareHandler} from 'hono'
import path from 'path'
import {app, Pylon} from '.'
import {Plugin, PylonConfig} from '../core'
import {Context} from '../core/context'
import {setAccessLog} from '../core/logger'
import {topoSortPlugins} from './plugin-order'
import {resolversToGraphQLResolvers} from '../core/define-pylon'
import {useUnhandledRoute} from '../plugins/use-unhandled-route'
import {useViewer} from '../plugins/use-viewer'

interface PylonHandlerOptions {
  graphql: {
    Query: Record<string, any>
    Mutation?: Record<string, any>
    Subscription?: Record<string, any>
  }
  config?: PylonConfig
}

type MaybeLazyObject<T> = T | (() => T)

const resolveLazyObject = <T>(obj: MaybeLazyObject<T>): T => {
  return typeof obj === 'function' ? (obj as () => T)() : obj
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Strip a Shopify-style global id (`gid://namespace/Type/localId`) back to its
 * raw local id; any non-gid value (a raw id, a number) passes through untouched,
 * so a client may hand back either form. This is the SINGLE place a gid is
 * decoded: the `ID` scalar below runs it on every `ID`-typed input (primary
 * keys, foreign keys, `node(id)`), so the ORM never sees a gid and needs no
 * per-write-path decoding. Output encoding is the symmetric per-type `id` field
 * resolver the compiler attaches. Decode is intentionally lenient — a scalar
 * can't know a field's expected model type, and globally-unique ids (snowflake,
 * cuid, uuid) make a wrong-type gid a harmless "not found" rather than a
 * cross-table collision.
 */
export const decodeGidInput = (value: unknown): unknown => {
  if (typeof value === 'string' && value.startsWith('gid://')) {
    const local = value.slice(value.lastIndexOf('/') + 1)
    return local || value
  }
  return value
}

/**
 * Merge two resolver maps ONE level deep: for a type present in both, combine its
 * field resolvers (`b` wins on conflict) rather than letting `b`'s type object
 * replace `a`'s wholesale. Lets build-side additions (interface `__resolveType`,
 * the `Node` layer's `Query.node` + per-type `id`) coexist with the app's own
 * `Query`/`Mutation`/entity resolvers instead of clobbering them.
 */
export const mergeResolverMaps = (
  a: Record<string, any> = {},
  b: Record<string, any> = {}
): Record<string, any> => {
  const out: Record<string, any> = {...a}
  for (const [key, bv] of Object.entries(b)) {
    const av = out[key]
    out[key] = isPlainObject(av) && isPlainObject(bv) ? {...av, ...bv} : bv
  }
  return out
}

const loadPluginsMiddleware = async (plugins: Plugin[], target: Pylon<any>) => {
  // Order by declared `dependsOn` (stable — a no-op when none declared), then load.
  for (const [i, plugin] of topoSortPlugins(plugins).entries()) {
    // Isolate + attribute setup failures: a bad plugin fails with WHICH plugin,
    // not an opaque stack from deep inside the loader.
    try {
      await plugin.setup?.(target)
    } catch (e) {
      throw new Error(
        `Pylon plugin "${plugin.name ?? `#${i}`}" failed during setup: ` +
          `${e instanceof Error ? (e.stack ?? e.message) : String(e)}`
      )
    }

    if (plugin.middleware) {
      target.pluginsMiddleware.push(plugin.middleware)
    }
  }
}

// `target` defaults to the singleton `app` so the existing generated entry —
// `executeConfig(config)` — is unchanged. Passing a specific Pylon lets a separate
// instance be configured independently (the basis of multi-instance composition).
export const executeConfig = async (
  config: PylonConfig,
  args?: {
    pluginsStrategy?: 'first' | 'last'
  },
  target: Pylon<any> = app
) => {
  // Boot the served ROOT, in order (both idempotent — runs for the 'first' and
  // 'last' passes): install the once-per-request base pipeline FIRST, then mount
  // the composed child tree, so the pipeline middleware precedes every route.
  target.installBasePipeline()
  target.realize()

  // Access-line toggle: `logger: false` silences the per-request access log (the request-scoped
  // `getLogger()` still works). Applied at boot, not per request.
  setAccessLog(config?.logger !== false)

  // Sentry is no longer auto-installed — apps opt in with `useSentry({dsn})` in their
  // config `plugins` (it now owns the HTTP middleware too). `useViewer` stays: it is
  // core plumbing, not vendor-specific.
  const plugins = [useViewer(), ...(config?.plugins || [])]

  if (config?.landingPage ?? true) {
    plugins.push(useUnhandledRoute())
  }

  if (config?.graphiql === false) {
    plugins.push(useDisableIntrospection() as Plugin)
  }

  const pluginsStrategy = args?.pluginsStrategy || 'first'

  await loadPluginsMiddleware(
    plugins.filter(p => {
      if (!p.strategy) {
        p.strategy = 'first'
      }

      return p.strategy === pluginsStrategy
    }),
    target
  )

  config.plugins = plugins

  target.config = config
}

export const handler = (options: PylonHandlerOptions, target: Pylon<any> = app) => {
  let {
    typeDefs,
    resolvers,
    graphql: graphql$
  } = options as PylonHandlerOptions & {
    typeDefs?: string
    resolvers?: Record<string, any>
  }

  const graphql = resolveLazyObject(graphql$)

  const config = target.config as PylonConfig

  if (!typeDefs) {
    // Try to read the schema from the default location
    const schemaPath = path.join(process.cwd(), '.pylon', 'schema.graphql')

    // If `schemaPath` is provided, read the schema from the file
    if (schemaPath) {
      typeDefs = readFileSync(schemaPath, 'utf-8')
    }
  }

  if (!typeDefs) {
    throw new Error('No schema provided.')
  }

  if (!resolvers) {
    // Try to read the resolvers from the default location
    const resolversPath = path.join(process.cwd(), '.pylon', 'resolvers.js')

    // If `resolversPath` is provided, read the resolvers from the file

    if (resolversPath) {
      resolvers = require(resolversPath).resolvers
    }
  }

  // Build the executable schema from (typeDefs, graphql resolvers, base resolvers).
  // Extracted so a dev hot-swap can rebuild it with fresh values (see the swap seam
  // below). See rfcs/DEV_SERVER.md (Step 2).
  const buildSchema = (
    typeDefs: string,
    graphql: any,
    resolvers: Record<string, any> | undefined
  ) => {
    const graphqlResolvers = resolversToGraphQLResolvers(graphql)

    return createSchema<Context>({
    typeDefs,
    resolvers: {
      // One level deep: build-side type maps (interface `__resolveType`, the ORM
      // `Node` layer's `Query.node` + per-type `id`) merge INTO the app's own
      // resolvers for the same type, instead of replacing the whole type object.
      // Build-defined fields win on conflict; user fields are preserved.
      ...mergeResolverMaps(graphqlResolvers, resolvers),
      // Global-id boundary: decode `gid://…` back to the raw local id on EVERY
      // `ID`-typed input (primary keys, foreign keys), so the ORM stays gid-free.
      // Output stays as-is — only the compiler's per-type `id` field resolver
      // emits a gid; this scalar's `serialize` is the plain ID string coercion.
      ID: new GraphQLScalarType({
        name: 'ID',
        description:
          'A global id (`gid://namespace/Type/localId`) or a raw local id. Decoded to the raw local id on input.',
        serialize: value => (value == null ? value : String(value)),
        parseValue: decodeGidInput,
        parseLiteral: ast =>
          ast.kind === Kind.STRING || ast.kind === Kind.INT
            ? decodeGidInput(ast.value)
            : null
      }),
      // The `node(id: GID!)` refetch field is the ONE input that must keep the
      // WHOLE gid — it dispatches on the embedded type (`gid://ns/Type/local`),
      // which the stripping `ID` scalar would tear off. So global ids get a
      // dedicated passthrough scalar, used only by `node`. Bound only when the
      // schema declares it (i.e. an app opted into `node: true`).
      ...(typeDefs?.includes('scalar GID')
        ? {
            GID: new GraphQLScalarType({
              name: 'GID',
              description: 'A global id (`gid://namespace/Type/localId`), passed through verbatim.',
              serialize: value => (value == null ? value : String(value)),
              parseValue: value => value,
              parseLiteral: ast => ('value' in ast ? ast.value : null)
            })
          }
        : {}),
      // Transforms a date object to a timestamp
      Date: new GraphQLScalarType({
        name: 'Date',
        description: 'Date represented as an ISO-8601 string',
        serialize: DateTimeISOResolver.serialize,
        parseValue: DateTimeISOResolver.parseValue,
        parseLiteral: DateTimeISOResolver.parseLiteral
      }),
      JSON: JSONResolver,
      JSONObject: JSONObjectResolver,
      Void: GraphQLVoid,
      Number: new GraphQLScalarType({
        name: 'Number',
        description: 'Custom scalar that handles both integers and floats',

        // Parsing input from query variables
        parseValue(value) {
          if (typeof value !== 'number') {
            throw new TypeError(`Value is not a number: ${value}`)
          }
          return value // Valid number
        },

        // Validation when sending from client (input literals)
        parseLiteral(ast) {
          if (ast.kind === Kind.INT || ast.kind === Kind.FLOAT) {
            return parseFloat(ast.value) // Convert the value to a float
          }
          throw new TypeError(
            `Value is not a valid number or float: ${
              'value' in ast ? ast.value : ast
            }`
          )
        },

        // Serialize output to be sent to the client
        serialize(value) {
          if (typeof value !== 'number') {
            throw new TypeError(`Value is not a number: ${value}`)
          }
          return value
        }
      })
    }
  })
  }

  const buildYoga = (schema: ReturnType<typeof buildSchema>) =>
    createYoga({
    graphqlEndpoint: '/graphql',
    // Dev: surface the REAL error (message + stack) on the GraphQL response and the
    // server log instead of Yoga's default "Unexpected error." masking — so a failing
    // resolver is debuggable in the browser and the terminal. Prod keeps the default
    // (masked, no internal leakage). The app can still override via `config`.
    ...(process.env.NODE_ENV === 'development' ? {maskedErrors: false} : {}),
    ...config,
    landingPage: false,
    graphiql:
      config?.graphiql !== false
        ? req => {
            return {
              shouldPersistHeaders: true,
              title: 'Pylon Playground',
              defaultQuery: `# Welcome to the Pylon Playground!`
            }
          }
        : false,
      schema
    })

  let currentYoga = buildYoga(buildSchema(typeDefs, graphql, resolvers))

  // Dev hot-swap seam: rebuild schema + yoga from fresh values and swap the ref (the
  // middleware reads `currentYoga` per request). Prod never calls this — set once
  // above. See rfcs/DEV_SERVER.md (Step 2).
  if (process.env.NODE_ENV === 'development') {
    ;(globalThis as any).__PYLON_DEV_SWAP_SCHEMA__ = (
      td: string,
      gql: unknown,
      res: Record<string, any> | undefined
    ) => {
      currentYoga = buildYoga(buildSchema(td, resolveLazyObject(gql), res))
    }
  }

  const handler: MiddlewareHandler = async (c, next) => {
    let executionContext: Context['executionCtx'] | {} = {}

    try {
      executionContext = c.executionCtx
    } catch (e) {}

    const response = await currentYoga.fetch(c.req.raw, c.env, executionContext)

    if (response.status === 404) {
      return next()
    }

    const version = (globalThis as any).__PYLON_VERSION__

    if (version) {
      c.header('X-Pylon-Version', version)
    }

    return c.newResponse(response.body, response)
  }

  return handler
}
