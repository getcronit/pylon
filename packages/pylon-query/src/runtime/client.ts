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
        // as the operation's data. Cross-query consistency falls out of this.
        const {root, entities} = normalize(res.data)
        this.store.mergeEntities(entities)
        this.store.patch(key, {
          data: root,
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

    this.store.patch(key, {promise})
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

    if (entry?.data !== undefined) {
      const isFresh =
        !entry.stale &&
        entry.writtenAt !== undefined &&
        Date.now() - entry.writtenAt < this.freshMs
      if (!isFresh && entry.promise === undefined) {
        // revalidate in the background; keep serving current data
        void this.fetch(d, variables).catch(() => {})
      }
      return {key, data: entry.data as TResult}
    }

    if (entry?.promise) return {key, promise: entry.promise}
    return {key, promise: this.fetch(d, variables)}
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
    rootExtras?: Record<string, unknown>
  ): T {
    return wrapResult<T>(getRoot, this.descriptor, rootExtras, this.deref)
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
