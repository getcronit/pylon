import {op as runtimeOp} from '@getcronit/pylon/query'
import type {Data, Mutations} from './index'

/**
 * Imperative operation runner — the `resolve` replacement. NOT a hook: imperative
 * ops only run in the browser (event handlers / effects), so `op` is a plain
 * object that reaches the registered singleton client. Authored as:
 *
 *   const loc = await op.query(q => q.organization.locations({ … }).nodes.at(0))
 *   const { userErrors } = await op.mutation(m => m.createUser({ … }))
 *
 * The build-time analyzer rewrites each `op.query(cb)` / `op.mutation(cb)` into
 * `op.query(doc, variablesThunk, cb)`: the callback's field access compiles to a
 * document + variables; the callback is kept and run against the wrapped,
 * normalized result for the projection (so a mutation also updates every reader).
 */
export interface Op {
  query<T>(selector: (q: Data) => T): Promise<T>
  mutation<T>(selector: (m: Mutations) => T): Promise<T>
}

export const op: Op = runtimeOp as unknown as Op
