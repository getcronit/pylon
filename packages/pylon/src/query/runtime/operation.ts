import type {PylonQueryClient} from './client'
import type {TypedDoc} from './doc'

/**
 * The imperative operation runner — the `resolve` replacement. NOT a hook, so it
 * works both in the browser (event handlers / effects) and in non-React server
 * code (a sitemap module, a queue job) — anywhere a compiled operation should run
 * against the app's own schema without threading a client through React context.
 *
 *   const loc = await op.query(q => q.organization.locations({ … }).nodes.at(0))
 *   const res = await op.mutation(m => m.createUser({ … }).userErrors)
 *
 * Two ways a client reaches `op`:
 *   - Browser: the generated client `registerOperationClient(client)`s a single
 *     process-wide singleton (there is one browser client).
 *   - Server: a request-scoped resolver installed via `setOperationClientResolver`
 *     is consulted FIRST. It's backed by AsyncLocalStorage, so concurrent requests
 *     each see their own per-request client (own store, own header-forwarding
 *     fetcher) instead of sharing one process-global client. See the pages setup.
 *
 * The analyzer rewrites each `op.query(cb)` / `op.mutation(cb)` into
 * `op.query(doc, variablesThunk, cb)`: `cb`'s field access compiles to a document
 * + variables; `cb` is kept and run against the wrapped result for the
 * projection. `query` and `mutation` are identical at runtime (the document body
 * carries the operation type).
 */
let registered: PylonQueryClient | undefined
let resolveScoped: (() => PylonQueryClient | undefined) | undefined

/** Register the client `op` uses. The generated client calls this in the browser. */
export function registerOperationClient(client: PylonQueryClient): void {
  registered = client
}

/**
 * Install a request-scoped client resolver, consulted before the browser
 * singleton. Server-only: the pages runtime backs this with an AsyncLocalStorage
 * so each in-flight request binds its own per-request client around the module
 * invocation (see `runWithOperationClient` at the call site). A plain global
 * `registerOperationClient` on the server would share one client — and one entity
 * store — across every concurrent request; this keeps them isolated.
 */
export function setOperationClientResolver(
  resolver: () => PylonQueryClient | undefined
): void {
  resolveScoped = resolver
}

async function run(
  docOrSelector: TypedDoc<any, any> | ((root: any) => any),
  thunk?: () => Record<string, unknown>,
  selector?: (root: any) => any
): Promise<any> {
  if (typeof docOrSelector === 'function' || !selector) {
    throw new Error(
      'op.query/op.mutation must be analyzed at build time (no document was ' +
        'injected). Pass an inline `q => …` / `m => …` selector.'
    )
  }
  // Request-scoped client (server) wins over the browser singleton; on the server
  // outside a bound request, and in the browser before the client loads, neither is set.
  const client = resolveScoped?.() ?? registered
  if (!client) {
    throw new Error(
      'pylon-query: no client available for `op`. In the browser this means it ran ' +
        'before the generated client loaded. On the server, `op` must run inside a ' +
        'request-scoped client binding (the pages runtime provides one for sitemap ' +
        'modules) — it is not available at module top level or outside a request.'
    )
  }
  const variables = thunk ? thunk() : undefined
  // client.fetch always fetches (no cache read) and normalizes the result into
  // the entity table, so a mutation updates every useData reader.
  const data = await client.fetch(docOrSelector, variables as any)
  // wrapDoc (not raw wrapData) so a selector reading one field with different args
  // at multiple call sites routes each to its own slot — same arg-alias seam the
  // hook read paths use.
  return selector(client.wrapDoc(docOrSelector, () => data, () => variables))
}

export interface Operation {
  query<T>(selector: (q: any) => T): Promise<T>
  mutation<T>(selector: (m: any) => T): Promise<T>
}

export const op: Operation = {
  query: (a: any, b?: any, c?: any) => run(a, b, c),
  mutation: (a: any, b?: any, c?: any) => run(a, b, c)
}
