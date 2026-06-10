/**
 * Apps — modular feature bundles for Pylon.
 *
 * An app is a plugin's worth of runtime wiring (Hono routes) PLUS the two things
 * a runtime plugin can't carry: a COMPILE-TIME GraphQL fragment and owned models
 * (→ scoped migrations). So: `app = plugin + graphql fragment + models`.
 *
 *   // src/apps/blog/index.ts
 *   export const blog = defineApp({
 *     name: 'blog',
 *     models: [Author, Article],
 *     graphql: { Query: { author: (id: number) => Author.objects.get({id}) } },
 *     routes: app => app.get('/blog/health', c => c.text('ok')),
 *   })
 *
 *   // src/index.ts
 *   export const apps = [blog, shop]        // the migration CLI reads this
 *   export const graphql = createApp(apps)  // merged + typed; routes mounted
 *
 * `createApp` composes the apps into the single, statically-introspected
 * `graphql` export (the compiler reads its TYPE — so the merge must be typed, not
 * just a runtime spread) and mounts each app's Hono routes. Migrations are driven
 * separately by the CLI, which reads `export const apps` and projects each app to
 * a pylon-db migration group — keeping the data layer free of app/graphql/Hono.
 */
import {app as honoApp} from './app/index.js'

/** A GraphQL resolver fragment an app contributes. */
export type AppGraphql = {
  Query?: Record<string, any>
  Mutation?: Record<string, any>
}

export interface AppDefinition<G extends AppGraphql = AppGraphql> {
  /** Unique app name — also the migration ledger namespace. */
  name: string
  /** Model classes the app owns (→ entities + scoped migrations). */
  models?: Function[]
  /** GraphQL resolver fragment, merged into the host schema by `createApp`. */
  graphql?: G
  /** Hono routes / middleware, mounted on the app by `createApp`. */
  routes?: (app: typeof honoApp) => void
  /** Names of apps this one depends on (migration order + cross-app FK targets). */
  dependencies?: string[]
  /** Explicit migrations directory (default: <migrations root>/<name>). */
  migrations?: string
}

/** Author an app manifest. Preserves the graphql fragment's concrete type. */
export function defineApp<const T extends AppDefinition>(app: T): T {
  return app
}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never

type MergeKey<A extends readonly AppDefinition[], K extends keyof AppGraphql> = UnionToIntersection<
  NonNullable<A[number]['graphql']>[K] extends infer T ? (T extends object ? T : never) : never
>

/**
 * Compose apps into the host. Returns the merged GraphQL resolver map — assign it
 * to `export const graphql` so the type-introspection build sees every app's
 * Query/Mutation in one schema — and mounts each app's Hono routes as a side
 * effect. Resolver name collisions resolve last-app-wins (apps order).
 */
export function createApp<const A extends readonly AppDefinition[]>(
  apps: A
): {Query: MergeKey<A, 'Query'>; Mutation: MergeKey<A, 'Mutation'>} {
  const Query: Record<string, any> = {}
  const Mutation: Record<string, any> = {}
  for (const app of apps) {
    Object.assign(Query, app.graphql?.Query)
    Object.assign(Mutation, app.graphql?.Mutation)
    app.routes?.(honoApp)
  }
  return {Query, Mutation} as any
}
