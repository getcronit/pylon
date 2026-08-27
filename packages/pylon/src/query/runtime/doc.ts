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
  /** Variable name carrying `skip` (offset) — drives `jumpTo(index)`. */
  skip?: string
  /** Variable name carrying `anchor` (a node id) — drives `seekTo(id)`: the server
   *  resolves the id's absolute index and returns the window + `startIndex`. */
  anchor?: string
}

/**
 * A compact, build-time projection of the operation's selection set — response
 * keys and their nesting, mirroring the wire `body`. It drives the runtime
 * COMPLETENESS gate (`isSatisfied`): a component only renders an operation once
 * every field it selected is present in the store. That is what makes partial
 * reads structurally impossible (see `./satisfied`), so the runtime needs no
 * GraphQL parser — the compiler derives this from the finished `body`.
 */
export interface ShapeField {
  /** Response key (alias or field name) as it appears in the data. */
  k: string
  /** Sub-selection for object/list fields; absent = leaf (presence-only check). */
  s?: ShapeField[]
  /**
   * Inline-fragment type condition: this field is only required when the owning
   * object's runtime `__typename` equals `t` (a field selected inside
   * `... on Ticket { … }` isn't expected on a Task).
   */
  t?: string
}

export interface DocInit {
  /** Stable, content-addressed document id (build-time hash of `body`). */
  id: string
  /** The GraphQL operation source sent over the wire. */
  body: string
  /** Operation name (debug + dedupe aid). */
  name: string
  /**
   * Selection shape driving the completeness gate (`./satisfied`). Present on
   * compiled query documents; absent on hand-authored / mutation docs, where its
   * absence disables gating (back-compat: those never suspended on completeness).
   */
  shape?: ShapeField[]
  /**
   * The operation declares `$__locale` via `@inContext`. The CLIENT supplies it, so the
   * locale is merged into `variables` before `opKey` hashes them — which is what keeps two
   * locales in two cache entries rather than one.
   */
  inContext?: boolean
  connection?: ConnectionMeta
  /** For mutations: the single top-level field whose value `mutate()` returns. */
  rootField?: string
  /**
   * Root fields read with multiple different-args call sites — each emitted as its own
   * aliased response field. fieldName → branches ({alias, arg→variable}); the read path
   * resolves it (with the call's variables) into an arg-hash→alias map so
   * `data.field(args)` routes to the matching slot. Absent unless a field has arg-branches.
   */
  argAliases?: Record<string, Array<{alias: string; args: Record<string, string>}>>
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
