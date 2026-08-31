import type {SchemaDescriptor} from './descriptor'
import {opKey, type DocInit, type TypedDoc} from './doc'
import {
  defaultFetcher,
  type FetcherOptions,
  type FetcherResult,
  type GraphQLRequest
} from './fetcher'
import {isRef, normalize} from './normalize'
import {isSatisfied} from './satisfied'
import {Store} from './store'
import {buildArgAliasMap, wrapResult, type ArgAliasMapSource} from './wrap'

/** Empty descriptor — every field falls back to raw values (no wrapping). */
const EMPTY_DESCRIPTOR: SchemaDescriptor = {query: 'Query', types: {}}

/** Max live read-path identity buckets (one per base operation key), LRU-evicted. */
const IDENTITY_BUCKET_LIMIT = 64

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
  /**
   * Locale supplied to documents compiled with `@inContext`.
   *
   * Held PER CLIENT, not in a module-level variable. The SSR pass builds one client per
   * request, so concurrent renders in different locales cannot bleed into each other — the
   * exact failure that makes a module-global i18next instance unsafe on a server. In the
   * browser there is one client and one locale, because switching locale is a document
   * navigation.
   */
  locale?: string
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

  private readonly locale?: string

  /**
   * Ops we've already refetched once for completeness (see `ensure`). A loop
   * backstop: if a completeness-driven refetch resolves and the op is STILL
   * incomplete (a pathological shared-entity race, or a server that omits a
   * selected field), we serve the data we have instead of suspending forever.
   */
  private readonly completenessRefetch = new Set<string>()

  /**
   * Read-path identity caches, one `WeakMap<rawEntity, proxy>` per operation key
   * (doc + variables). Bucketing per operation keeps proxy identity within a single
   * operation's renders — where its arg-alias routing is value-stable — and never
   * lets two operations with different variables share a proxy (which could misroute
   * a callable field). Entries are WeakMap-held, so an evicted entity's proxy is GC'd;
   * the outer Map is bounded by the number of live operation keys.
   */
  private readonly identityCaches = new Map<string, WeakMap<object, unknown>>()

  private identityBucket(key: string): WeakMap<object, unknown> {
    let bucket = this.identityCaches.get(key)
    if (bucket) {
      // Touch for LRU recency (re-insert moves it to the end of the Map order).
      this.identityCaches.delete(key)
      this.identityCaches.set(key, bucket)
      return bucket
    }
    bucket = new WeakMap<object, unknown>()
    this.identityCaches.set(key, bucket)
    // Bound the number of live operation buckets (each is a tiny WeakMap; entries
    // GC with their entities). Evict the least-recently-used base op — its next
    // read just rebuilds proxies, no correctness impact.
    if (this.identityCaches.size > IDENTITY_BUCKET_LIMIT) {
      const oldest = this.identityCaches.keys().next().value
      if (oldest !== undefined) this.identityCaches.delete(oldest)
    }
    return bucket
  }

  constructor(opts: PylonQueryClientOptions = {}) {
    this.locale = opts.locale
    this.fetcher = opts.fetcher ?? (defaultFetcher as Fetcher)
    this.descriptor = opts.descriptor ?? EMPTY_DESCRIPTOR
    this.options = {endpoint: opts.endpoint, fetchOptions: opts.fetchOptions}
    // Default: a few seconds of freshness — long enough to break notify-driven
    // refetch loops, short enough that navigating back later revalidates.
    this.freshMs = opts.freshMs ?? 5_000
  }

  /** Fire the operation, deduping concurrent identical requests via the store. */
  /**
   * Supply `$__locale` for an `@inContext` document.
   *
   * Merged BEFORE `opKey` hashes the variables — that is the whole point. Two locales then
   * produce two cache entries instead of colliding on one, in the store and in the
   * hydration payload alike.
   */
  private withLocale<TVars extends Record<string, unknown>>(
    d: {inContext?: boolean},
    variables?: TVars
  ): TVars | undefined {
    if (!d.inContext || this.locale === undefined) return variables
    return {...(variables ?? {}), __locale: this.locale} as unknown as TVars
  }

  fetch<TResult, TVars extends Record<string, unknown>>(
    d: TypedDoc<TResult, TVars>,
    rawVariables?: TVars
  ): Promise<TResult> {
    const variables = this.withLocale(d, rawVariables)
    const key = opKey(d, variables)
    const existing = this.store.get(key)
    if (existing?.promise) return existing.promise as Promise<TResult>

    const promise = this.fetcher<TResult>(
      {query: d.body, variables, operationName: d.name},
      this.options
    ).then(
      res => {
        // Partial results are legal GraphQL: `data` and `errors` coexist when a
        // field resolver throws but its (nullable) siblings resolve. The prime
        // case is FEATURE GATING — a statically-compiled `useData` document can't
        // know which features a tenant has, so it always selects gated fields; a
        // disabled one throws FEATURE_DISABLED (that field comes back `null`, the
        // rest come back fine). Only when NO usable data came back is it a true
        // total failure (auth on the whole request, network error, a non-null
        // field nulling the root) — then keep the old fail-loud behavior.
        const hasErrors = !!(res.errors && res.errors.length)
        const hasData =
          res.data != null &&
          (typeof res.data !== 'object' ||
            Object.keys(res.data as Record<string, unknown>).length > 0)
        if (hasErrors && !hasData) {
          const err = new GraphQLResultError(res.errors!)
          this.store.patch(key, {error: err, promise: undefined})
          throw err
        }
        // Surface the swallowed field errors in dev so a genuine resolver bug
        // (as opposed to an expected feature gate) doesn't vanish silently.
        if (hasErrors && typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
          console.warn(
            `[pylon-query] "${d.name ?? 'query'}" returned partial data with ${res.errors!.length} field error(s):`,
            res.errors!.map(e => e.message).join('; ')
          )
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
          partialErrors: hasErrors ? res.errors : undefined,
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
    rawVariables?: TVars
  ): QueryRead<TResult> {
    const variables = this.withLocale(d, rawVariables)
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
    if (entry?.data !== undefined) {
      // COMPLETENESS GATE: only render an operation whose whole selection is in
      // the store. A shared entity another op populated without a field THIS op
      // selected would otherwise be served, and that missing field surfaces as an
      // `undefined` hole that crashes component code (`x.totalCount`). When the
      // cached data is INCOMPLETE we suspend and refetch instead — the refetch of
      // THIS document fills every field it selected, so the read never sees a hole.
      // (`shape` absent → gate off → unchanged behavior; complete-but-stale still
      // serves immediately, so SWR never over-suspends on a mutation re-render.)
      if (isSatisfied(d.shape, entry.data, this.deref)) {
        this.completenessRefetch.delete(key)
        return {key, data: entry.data as TResult}
      }
      if (entry.promise) return {key, promise: entry.promise}
      // Backstop: at most ONE completeness refetch per episode. If it already ran
      // and the op is still incomplete, serve what we have rather than loop.
      if (this.completenessRefetch.has(key)) {
        return {key, data: entry.data as TResult}
      }
      this.completenessRefetch.add(key)
      return {key, promise: this.fetch(d, variables)}
    }

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
    rawVariables?: TVars
  ): void {
    const variables = this.withLocale(d, rawVariables)
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
    this.store.patch(opKey(d, this.withLocale(d, variables)), {
      promise: undefined,
      stale: true
    })
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
    debugLabel?: string,
    argAliasMap?: ArgAliasMapSource,
    getIdentityCache?: () => WeakMap<object, unknown> | undefined
  ): T {
    return wrapResult<T>(
      getRoot,
      this.descriptor,
      rootExtras,
      this.deref,
      rootTypeName ?? this.descriptor.query,
      debugLabel,
      argAliasMap,
      getIdentityCache
    )
  }

  /**
   * Wrap an operation root for component reads, deriving the arg-alias routing
   * from the document's `argAliases` and its resolved variables.
   *
   * EVERY read path (single-op, paginated, imperative `op`) must wrap through
   * this, not raw `wrapData` — the map-building and the wrapping are one
   * invariant, and splitting them across call sites is exactly how the paginated
   * path silently regressed (both `timeline({query:…})` reads collapsed to the
   * base slot). Centralizing here makes routing impossible to forget: a caller
   * that has the doc gets it for free.
   *
   * `getVariables` is a thunk so the (possibly TDZ-sensitive, lazily-evaluated)
   * variables are read at field-access time, and the map is built lazily — only
   * if a field carrying `argAliases` is actually read.
   */
  wrapDoc<T = any>(
    doc: Pick<DocInit, 'argAliases' | 'name' | 'id'>,
    getRoot: () => unknown,
    getVariables?: () => Record<string, unknown> | undefined,
    rootExtras?: Record<string, unknown>
  ): T {
    const {argAliases} = doc
    const argAliasMap: ArgAliasMapSource | undefined = argAliases
      ? () => buildArgAliasMap(argAliases, getVariables?.())
      : undefined
    // Per-operation identity bucket. Keyed by opKey (doc + variables) so proxy
    // identity is scoped to one operation instance — resolved lazily (inside the
    // wrap, at first object read) because the variables aren't TDZ-safe to touch
    // at the top of render. `doc.id` may be absent for a raw/imperative doc; then
    // there is no stable key, so caching is skipped (getRoot-only reads).
    const getIdentityCache = doc.id
      ? () => this.identityBucket(opKey(doc as Pick<DocInit, 'id'>, getVariables?.()))
      : undefined
    return this.wrapData<T>(getRoot, rootExtras, undefined, doc.name, argAliasMap, getIdentityCache)
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
