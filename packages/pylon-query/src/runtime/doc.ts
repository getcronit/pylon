import {variablesHash} from './hash'

/**
 * Metadata the analyzer attaches to a connection document so `usePaginatedData`
 * knows which variables drive the Relay window.
 */
export interface ConnectionMeta {
  /** Path to the connection object within the result root, e.g. `["posts"]`. */
  path: string[]
  /** Variable name carrying `first` (forward page size), e.g. `"v0"`. */
  first?: string
  /** Variable name carrying `after` (forward cursor). */
  after?: string
  /** Variable name carrying `last` (backward page size). */
  last?: string
  /** Variable name carrying `before` (backward cursor). */
  before?: string
}

export interface DocInit {
  /** Stable, content-addressed document id (build-time hash of `body`). */
  id: string
  /** The GraphQL operation source sent over the wire. */
  body: string
  /** Operation name (debug + dedupe aid). */
  name: string
  connection?: ConnectionMeta
  /** For mutations: the single top-level field whose value `mutate()` returns. */
  rootField?: string
}

/**
 * A compiled, typed GraphQL operation. `TResult` is the exact shape the
 * analyzer selected (carried as a phantom type — never present at runtime).
 *
 * This replaces gqty's runtime proxy: the document IS the query. It is emitted
 * by the analyzer at module scope, so it can never reference component locals
 * and therefore can never hit a temporal dead zone (only the variables thunk
 * passed at the call site touches locals — see `useData`).
 */
export interface TypedDoc<
  TResult = unknown,
  TVars extends Record<string, unknown> = Record<string, unknown>
> extends DocInit {
  /** phantom — structural result type, stripped at runtime */
  readonly __result?: TResult
  /** phantom — variables shape, stripped at runtime */
  readonly __vars?: TVars
}

/**
 * Construct a typed document. The analyzer injects calls to this at module
 * scope. Hand-authored escape-hatch documents go through `graphql` (see
 * `./graphql-tag`).
 */
export function doc<
  TResult = unknown,
  TVars extends Record<string, unknown> = Record<string, unknown>
>(init: DocInit): TypedDoc<TResult, TVars> {
  return init as TypedDoc<TResult, TVars>
}

/** Content-addressed cache + hydration key for a (document, variables) pair. */
export function opKey(d: Pick<DocInit, 'id'>, variables: unknown): string {
  return `${d.id}~${variablesHash(variables)}`
}
