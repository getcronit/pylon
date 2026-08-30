import type {PylonQueryClient} from './client'
import type {TypedDoc} from './doc'

/**
 * The imperative operation runner — the `resolve` replacement. NOT a hook:
 * imperative ops only run in the browser (event handlers / effects, never SSR),
 * where there's a single client, so it grabs the registered client instead of
 * React context. That keeps module-level fetch helpers module-level.
 *
 *   const loc = await op.query(q => q.organization.locations({ … }).nodes.at(0))
 *   const res = await op.mutation(m => m.createUser({ … }).userErrors)
 *
 * The analyzer rewrites each `op.query(cb)` / `op.mutation(cb)` into
 * `op.query(doc, variablesThunk, cb)`: `cb`'s field access compiles to a document
 * + variables; `cb` is kept and run against the wrapped result for the
 * projection. `query` and `mutation` are identical at runtime (the document body
 * carries the operation type).
 */
let registered: PylonQueryClient | undefined

/** Register the client `op` uses. The generated client calls this in the browser. */
export function registerOperationClient(client: PylonQueryClient): void {
  registered = client
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
  if (!registered) {
    throw new Error(
      'pylon-query: no client registered for `op` (used before the client loaded ' +
        'or on the server — imperative ops are browser-only).'
    )
  }
  const variables = thunk ? thunk() : undefined
  // client.fetch always fetches (no cache read) and normalizes the result into
  // the entity table, so a mutation updates every useData reader.
  const data = await registered.fetch(docOrSelector, variables as any)
  // wrapDoc (not raw wrapData) so a selector reading one field with different args
  // at multiple call sites routes each to its own slot — same arg-alias seam the
  // hook read paths use.
  return selector(registered.wrapDoc(docOrSelector, () => data, () => variables))
}

export interface Operation {
  query<T>(selector: (q: any) => T): Promise<T>
  mutation<T>(selector: (m: any) => T): Promise<T>
}

export const op: Operation = {
  query: (a: any, b?: any, c?: any) => run(a, b, c),
  mutation: (a: any, b?: any, c?: any) => run(a, b, c)
}
