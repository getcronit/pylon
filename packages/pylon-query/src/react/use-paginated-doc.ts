import {useCallback, useRef, useState, useSyncExternalStore} from 'react'
import {opKey, type TypedDoc} from '../runtime/doc'
import {usePylonQueryClient} from './context'

export interface PageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor?: string | null
  endCursor?: string | null
}

export interface PaginatedResult<TNode = any, TEdge = any> {
  /** Flattened nodes across all loaded windows (wrapped). */
  nodes: TNode[]
  /** Edges across all loaded windows (wrapped). */
  edges: TEdge[]
  /** Merged page info (next from the last window, prev from the first). */
  pageInfo: PageInfo
  totalCount?: number
  /**
   * Absolute index of `nodes[0]` within the full list — the offset a virtualizer
   * needs to place the loaded window against `totalCount`. 0 at the start / after
   * a base-variable reset, the `jumpTo` target after a jump, and shifts down as
   * `loadPrev` prepends.
   */
  startIndex: number
  loadNext: (n?: number) => Promise<void>
  loadPrev: (n?: number) => Promise<void>
  /**
   * Deep-link the window to an absolute node index via the connection's `skip`
   * offset (needs a `skip` arg on the connection). Replaces the loaded windows
   * with the anchor page; `loadNext`/`loadPrev` then continue keyset from there.
   */
  jumpTo: (index: number, n?: number) => Promise<void>
  /** Force-refetch every loaded window in place (keeps the current windows and
   *  scroll position). Used to refresh after a mutation / tag-refetch. */
  refetch: () => Promise<void>
  isLoadingMore: boolean
}

export interface UsePaginatedDocOptions {
  /** Initial page size. */
  first?: number
}

/** A loaded window: the variable overrides used to fetch it. */
interface Window {
  vars: Record<string, unknown>
}

function getAtPath(obj: any, path: string[]): any {
  let cur = obj
  for (const k of path) {
    if (cur == null) return undefined
    cur = cur[k]
    // The connection field takes args (first/after), so the result wrapper
    // exposes it as a callable; invoke to get the connection value. (Raw data
    // is a plain object here, so this is a no-op on the un-wrapped path.)
    if (typeof cur === 'function') cur = cur()
  }
  return cur
}

/**
 * Read the connection at `path` from an operation's stored root, going through
 * the WRAPPED view so normalized refs are dereferenced (an intermediate field
 * with an `id` — e.g. `post` in `post.comments` — is a ref in the raw root).
 */
function readConnection(client: any, data: any, path: string[]): any {
  if (data == null) return undefined
  return getAtPath(client.wrapData(() => data), path)
}

/**
 * Relay-connection pagination over a single analyzer-emitted connection
 * document. Each window is a separate operation (same document, different
 * cursor variables); the store caches each, and this hook merges their edges.
 *
 * The first window is read via `ensure` (Suspense). Subsequent windows are
 * fetched imperatively by `loadNext`/`loadPrev` (no Suspense — `isLoadingMore`
 * drives a spinner) and appended.
 */
export function usePaginatedDoc<TResult, TVars extends Record<string, unknown>>(
  doc: TypedDoc<TResult, TVars>,
  variablesThunk?: () => TVars,
  options?: UsePaginatedDocOptions
): PaginatedResult {
  const client = usePylonQueryClient()
  const conn = doc.connection
  if (!conn) {
    throw new Error(
      `usePaginatedData: document "${doc.name}" has no connection metadata. ` +
        `It must select a Relay connection (edges/node/pageInfo).`
    )
  }
  const pageSize = options?.first ?? 20

  useSyncExternalStore(
    client.store.subscribe,
    client.store.getVersion,
    client.store.getVersion
  )

  // The loaded windows in DISPLAY order (head = oldest, tail = newest), plus the
  // absolute index of the head window's first node. Empty `windows` = not yet
  // interacted with → the lazy default below provides the first (Suspense) window.
  const [windows, setWindows] = useState<Window[]>([])
  const [startIndex, setStartIndex] = useState(0)
  const [isLoadingMore, setLoadingMore] = useState(false)
  const baseRef = useRef<Record<string, unknown>>({})

  const readBase = (): Record<string, unknown> => {
    const v = (variablesThunk ? variablesThunk() : {}) as Record<string, unknown>
    baseRef.current = v
    return v
  }

  const firstWindowVars = (base: Record<string, unknown>) => ({
    ...base,
    ...(conn.first ? {[conn.first]: pageSize} : {})
  })

  // Current display windows, materializing the lazy default when none are set.
  const liveWindows = (): Window[] =>
    windows.length ? windows : [{vars: firstWindowVars(baseRef.current)}]

  // ── loaders ──────────────────────────────────────────────────────────────
  const loadNext = useCallback(
    async (n?: number) => {
      const eff = liveWindows()
      const tail = eff[eff.length - 1]
      const tailData = client.store.get(opKey(doc, tail.vars))?.data
      const endCursor = readConnection(client, tailData, conn.path)?.pageInfo
        ?.endCursor
      if (endCursor == null || !conn.after) return
      const vars = {
        ...baseRef.current,
        ...(conn.first ? {[conn.first]: n ?? pageSize} : {}),
        [conn.after]: endCursor
      }
      setLoadingMore(true)
      try {
        await client.fetch(doc, vars as TVars)
        setWindows([...eff, {vars}]) // append: startIndex unchanged
      } finally {
        setLoadingMore(false)
      }
    },
    [client, doc, windows, pageSize]
  )

  const loadPrev = useCallback(
    async (n?: number) => {
      const eff = liveWindows()
      const headData = client.store.get(opKey(doc, eff[0].vars))?.data
      const startCursor = readConnection(client, headData, conn.path)?.pageInfo
        ?.startCursor
      if (startCursor == null || !conn.before) return
      const vars = {
        ...baseRef.current,
        ...(conn.last ? {[conn.last]: n ?? pageSize} : {}),
        [conn.before]: startCursor
      }
      setLoadingMore(true)
      try {
        await client.fetch(doc, vars as TVars)
        // Prepend: the head's first node moves down by however many we fetched.
        const added =
          readConnection(client, client.store.get(opKey(doc, vars))?.data, conn.path)
            ?.edges?.length ?? 0
        setWindows([{vars}, ...eff])
        setStartIndex(s => Math.max(0, s - added))
      } finally {
        setLoadingMore(false)
      }
    },
    [client, doc, windows, pageSize]
  )

  const jumpTo = useCallback(
    async (index: number, n?: number) => {
      const target = Math.max(0, Math.floor(index ?? 0))
      if (target > 0 && !conn.skip) {
        throw new Error(
          `usePaginatedData: jumpTo(index) needs a "skip" arg on the connection ` +
            `"${doc.name}". Only cursor-adjacent loadNext/loadPrev are available.`
        )
      }
      const vars = {
        ...baseRef.current,
        ...(conn.first ? {[conn.first]: n ?? pageSize} : {}),
        ...(target > 0 && conn.skip ? {[conn.skip]: target} : {})
      }
      setLoadingMore(true)
      try {
        await client.fetch(doc, vars as TVars)
        setWindows([{vars}]) // replace the stack with the anchor page
        setStartIndex(target)
      } finally {
        setLoadingMore(false)
      }
    },
    [client, doc, pageSize]
  )

  const refetch = useCallback(async () => {
    const eff = liveWindows()
    setLoadingMore(true)
    try {
      // Force a fresh fetch of every loaded window (in place — windows + scroll
      // position are preserved). The store update re-renders with fresh data.
      await Promise.all(eff.map(w => client.refetch(doc, w.vars as TVars)))
    } finally {
      setLoadingMore(false)
    }
  }, [client, doc, windows])

  // ── base-variable reset ────────────────────────────────────────────────────
  // A changed base (e.g. a new search `query`) invalidates the cursor windows, so
  // fall back to a single fresh window. Done during render (bounded by the sig
  // ref) so this render already uses the reset window for Suspense + merge.
  const base = readBase()
  const baseSig = JSON.stringify(base)
  const sigRef = useRef(baseSig)
  let resetting = false
  if (sigRef.current !== baseSig) {
    sigRef.current = baseSig
    resetting = true
    if (windows.length) setWindows([])
    if (startIndex !== 0) setStartIndex(0)
  }

  const effWindows: Window[] =
    !resetting && windows.length ? windows : [{vars: firstWindowVars(base)}]
  const effStartIndex = resetting ? 0 : startIndex

  // ── read + merge (Suspense on the head window) ─────────────────────────────
  const headRead = client.ensure(doc, effWindows[0].vars as TVars)
  if (headRead.error !== undefined) throw headRead.error
  if (headRead.promise) throw headRead.promise

  // Merge edges across all windows that already have data, in display order. All
  // reads go through the deref-aware wrapped connection.
  const mergedEdges: any[] = []
  const seenCursors = new Set<string>()
  let firstConn: any
  let lastConn: any
  let totalCount: number | undefined

  effWindows.forEach((w, idx) => {
    const data =
      idx === 0 ? headRead.data : client.store.get(opKey(doc, w.vars))?.data
    const connWrapped = readConnection(client, data, conn.path)
    if (connWrapped == null) return
    if (idx === 0) firstConn = connWrapped
    lastConn = connWrapped
    if (typeof connWrapped.totalCount === 'number') {
      totalCount = connWrapped.totalCount
    }
    const edges = connWrapped.edges ?? []
    for (let i = 0; i < edges.length; i++) {
      const cursor = edges[i]?.cursor
      if (cursor != null) {
        if (seenCursors.has(cursor)) continue
        seenCursors.add(cursor)
      }
      mergedEdges.push(edges[i])
    }
  })

  const pageInfo: PageInfo = {
    hasNextPage: !!lastConn?.pageInfo?.hasNextPage,
    hasPreviousPage: !!firstConn?.pageInfo?.hasPreviousPage,
    startCursor: firstConn?.pageInfo?.startCursor,
    endCursor: lastConn?.pageInfo?.endCursor
  }

  return {
    edges: mergedEdges,
    nodes: mergedEdges.map(e => e?.node),
    pageInfo,
    totalCount,
    startIndex: effStartIndex,
    loadNext,
    loadPrev,
    jumpTo,
    refetch,
    isLoadingMore
  }
}
