import type {SchemaDescriptor} from './descriptor'
import {opKey, type TypedDoc} from './doc'
import {
  defaultFetcher,
  type FetcherOptions,
  type FetcherResult,
  type GraphQLRequest
} from './fetcher'
import {isRef, normalize} from './normalize'
import {Store} from './store'
import {wrapResult} from './wrap'

/** Empty descriptor — every field falls back to raw values (no wrapping). */
const EMPTY_DESCRIPTOR: SchemaDescriptor = {query: 'Query', types: {}}

export type Fetcher = <TData = unknown>(
  request: GraphQLRequest,
  options: FetcherOptions
) => Promise<FetcherResult<TData>>

export interface PylonQueryClientOptions extends FetcherOptions {
  fetcher?: Fetcher
  /** Freshness window (ms). Within it a cached entry is not revalidated. */
  freshMs?: number
  /** Schema descriptor driving the result wrapper. */
  descriptor?: SchemaDescriptor
}

/**
 * A read of a document at given variables: either resolved data, or a promise
 * to throw for Suspense. Mirrors the shape React's use()/Suspense expects.
 */
export interface QueryRead<TResult> {
  key: string
  data?: TResult
  error?: unknown
  promise?: Promise<unknown>
}

export class PylonQueryClient {
  readonly store = new Store()
  readonly descriptor: SchemaDescriptor
  private readonly fetcher: Fetcher
  private readonly options: FetcherOptions
  private readonly freshMs: number

  constructor(opts: PylonQueryClientOptions = {}) {
    this.fetcher = opts.fetcher ?? (defaultFetcher as Fetcher)
    this.descriptor = opts.descriptor ?? EMPTY_DESCRIPTOR
    this.options = {endpoint: opts.endpoint, fetchOptions: opts.fetchOptions}
    // Default: a few seconds of freshness — long enough to break notify-driven
    // refetch loops, short enough that navigating back later revalidates.
    this.freshMs = opts.freshMs ?? 5_000
  }

  /** Fire the operation, deduping concurrent identical requests via the store. */
  fetch<TResult, TVars extends Record<string, unknown>>(
    d: TypedDoc<TResult, TVars>,
    variables?: TVars
  ): Promise<TResult> {
    const key = opKey(d, variables)
    const existing = this.store.get(key)
    if (existing?.promise) return existing.promise as Promise<TResult>

    const promise = this.fetcher<TResult>(
      {query: d.body, variables, operationName: d.name},
      this.options
    ).then(
      res => {
        if (res.errors && res.errors.length) {
          const err = new GraphQLResultError(res.errors)
          this.store.patch(key, {error: err, promise: undefined})
          throw err
        }
        // Normalize: hoist entities into the canonical table, store the ref tree
        // as the operation's data. Cross-query consistency falls out of this —
        // a mutation patching an entity live-updates every op that refs it.
        //
        // This includes TOP-LEVEL connections (path length 1, e.g. q.tickets):
        // their nodes become entity refs (so list rows reflect mutations without
        // a refetch), while the connection object itself has no id and stays
        // inline in the op root per window — no clobber.
        //
        // EXCEPT NESTED connections (e.g. post.comments): the connection lives on
        // a parent entity's field, so normalizing would make each pagination
        // window overwrite that single field. Those stay inline per opKey.
        let data: unknown = res.data
        const nestedConnection = (d.connection?.path?.length ?? 0) > 1
        if (!nestedConnection) {
          const {root, entities} = normalize(res.data)
          this.store.mergeEntities(entities)
          data = root
        }
        this.store.patch(key, {
          data,
          error: undefined,
          promise: undefined,
          writtenAt: Date.now(),
          stale: false
        })
        return res.data as TResult
      },
      err => {
        this.store.patch(key, {error: err, promise: undefined})
        throw err
      }
    )

    // Silent: this may run during render (ensure() → SWR revalidate). The data
    // write in the .then above emits normally once resolved.
    this.store.patch(key, {promise}, true)
    return promise
  }

  /**
   * Read-or-fetch for Suspense. Returns resolved data when fresh in cache;
   * otherwise kicks off a fetch and returns its promise for the caller to throw.
   * Stale-while-revalidate: stale data is returned immediately AND revalidated.
   */
  ensure<TResult, TVars extends Record<string, unknown>>(
    d: TypedDoc<TResult, TVars>,
    variables?: TVars
  ): QueryRead<TResult> {
    const key = opKey(d, variables)
    const entry = this.store.get(key)

    if (entry?.error !== undefined && entry.promise === undefined) {
      return {key, error: entry.error}
    }

    // Render-pure: serve whatever is cached and NEVER kick off a time-based
    // revalidation here. `ensure` runs during render, and the global store
    // subscription re-renders every mounted query on ANY mutation — so a
    // revalidate-during-render would make one unrelated mutation refetch every
    // mounted query (a request storm). Mount/variables-change revalidation lives
    // in `revalidate()`, called from an effect. Cross-query freshness after a
    // mutation comes from entity normalization, not from refetching.
    if (entry?.data !== undefined) return {key, data: entry.data as TResult}

    if (entry?.promise) return {key, promise: entry.promise}
    return {key, promise: this.fetch(d, variables)}
  }

  /**
   * Stale-while-revalidate background check. Call from an EFFECT (mount /
   * variables change) — never during render. Serves the cached entry untouched
   * and, if it is older than `freshMs` (or explicitly marked stale), refetches
   * in the background. This is what makes navigating back to a page revalidate,
   * without coupling revalidation to unrelated re-renders.
   */
  revalidate<TResult, TVars extends Record<string, unknown>>(
    d: TypedDoc<TResult, TVars>,
    variables?: TVars
  ): void {
    const key = opKey(d, variables)
    const entry = this.store.get(key)
    // No data yet, or a fetch already in flight → render-time `ensure` owns it.
    if (!entry || entry.data === undefined || entry.promise !== undefined) return
    const isFresh =
      !entry.stale &&
      entry.writtenAt !== undefined &&
      Date.now() - entry.writtenAt < this.freshMs
    if (!isFresh) void this.fetch(d, variables).catch(() => {})
  }

  /** Force a refetch of a specific (document, variables) pair. */
  refetch<TResult, TVars extends Record<string, unknown>>(
    d: TypedDoc<TResult, TVars>,
    variables?: TVars
  ): Promise<TResult> {
    this.store.patch(opKey(d, variables), {promise: undefined, stale: true})
    return this.fetch(d, variables)
  }

  /**
   * SSR snapshot for `window.__pylon`: the operation ref-trees plus the entity
   * table they reference (refs would be dangling without it).
   */
  collect(): {ops: Record<string, unknown>; entities: Record<string, unknown>} {
    return {ops: this.store.snapshot(), entities: this.store.entitiesSnapshot()}
  }

  /** Client: seed the cache from a hydration payload (entities first). */
  hydrate(
    payload:
      | {ops?: Record<string, unknown>; entities?: Record<string, Record<string, unknown>>}
      | null
      | undefined
  ): void {
    if (!payload) return
    this.store.hydrateEntities(payload.entities)
    this.store.hydrate(payload.ops)
  }

  /** Resolve a ref into its canonical entity (identity for non-refs). */
  deref = (value: any): any =>
    isRef(value) ? this.store.getEntity(value.__ref) : value

  /**
   * Wrap an operation root (ref tree) for component reads — dereferencing
   * entities against the live table, so reads reflect later mutations.
   */
  wrapData<T = any>(
    getRoot: () => unknown,
    rootExtras?: Record<string, unknown>,
    rootTypeName?: string,
    debugLabel?: string
  ): T {
    return wrapResult<T>(
      getRoot,
      this.descriptor,
      rootExtras,
      this.deref,
      rootTypeName ?? this.descriptor.query,
      debugLabel
    )
  }

  /**
   * Run a mutation: send it, normalize the result into the entity table (so every
   * query reading the affected entities re-renders), and return the wrapped value
   * of the single top-level mutation field.
   */
  async runMutation<TResult = any>(
    doc: TypedDoc<TResult, any>,
    variables?: Record<string, unknown>
  ): Promise<any> {
    const res = await this.fetcher(
      {query: doc.body, variables, operationName: doc.name},
      this.options
    )
    if (res.errors && res.errors.length) {
      throw new GraphQLResultError(res.errors)
    }
    const {root, entities} = normalize(res.data)
    this.store.mergeEntities(entities)

    const rootObj = (root ?? {}) as Record<string, unknown>
    const fieldName = doc.rootField ?? Object.keys(rootObj)[0]
    const wrapped = this.wrapData<any>(() => root, undefined, 'Mutation')
    const fieldVal = fieldName ? wrapped[fieldName] : wrapped
    // Mutation fields take args → the wrapper exposes them as callable; invoke to
    // get the wrapped return value (args are decorative at read time).
    return typeof fieldVal === 'function' ? fieldVal() : fieldVal
  }
}

export class GraphQLResultError extends Error {
  constructor(public errors: Array<{message: string}>) {
    super(errors.map(e => e.message).join('; ') || 'GraphQL error')
    this.name = 'GraphQLResultError'
  }
}

export function createPylonQueryClient(
  opts?: PylonQueryClientOptions
): PylonQueryClient {
  return new PylonQueryClient(opts)
}
