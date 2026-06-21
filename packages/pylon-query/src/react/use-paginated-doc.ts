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
  loadNext: (n?: number) => Promise<void>
  loadPrev: (n?: number) => Promise<void>
  jumpTo: (cursor: string, n?: number) => Promise<void>
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

  const [extraWindows, setExtraWindows] = useState<Window[]>([])
  const [isLoadingMore, setLoadingMore] = useState(false)
  const baseRef = useRef<Record<string, unknown>>({})

  const baseVars = (): Record<string, unknown> => {
    const v = (variablesThunk ? variablesThunk() : {}) as Record<string, unknown>
    baseRef.current = v
    return v
  }

  const firstWindowVars = (base: Record<string, unknown>) => ({
    ...base,
    ...(conn.first ? {[conn.first]: pageSize} : {})
  })

  // Window list: window 0 (initial) + imperatively-appended windows.
  const allWindows = (base: Record<string, unknown>): Window[] => [
    {vars: firstWindowVars(base)},
    ...extraWindows
  ]

  // ── loaders ──────────────────────────────────────────────────────────────
  const loadNext = useCallback(
    async (n?: number) => {
      const base = baseRef.current
      const windows = [{vars: firstWindowVars(base)}, ...extraWindows]
      const last = windows[windows.length - 1]
      const lastData = client.store.get(opKey(doc, last.vars))?.data
      const endCursor = readConnection(client, lastData, conn.path)?.pageInfo
        ?.endCursor
      if (!endCursor) return
      const vars = {
        ...base,
        ...(conn.first ? {[conn.first]: n ?? pageSize} : {}),
        ...(conn.after ? {[conn.after]: endCursor} : {})
      }
      setLoadingMore(true)
      try {
        await client.fetch(doc, vars as TVars)
        setExtraWindows(w => [...w, {vars}])
      } finally {
        setLoadingMore(false)
      }
    },
    [client, doc, extraWindows, pageSize]
  )

  const loadPrev = useCallback(
    async (n?: number) => {
      const base = baseRef.current
      const windows = [{vars: firstWindowVars(base)}, ...extraWindows]
      const firstData = client.store.get(opKey(doc, windows[0].vars))?.data
      const startCursor = readConnection(client, firstData, conn.path)?.pageInfo
        ?.startCursor
      if (!startCursor) return
      const vars = {
        ...base,
        ...(conn.last ? {[conn.last]: n ?? pageSize} : {}),
        ...(conn.before ? {[conn.before]: startCursor} : {})
      }
      setLoadingMore(true)
      try {
        await client.fetch(doc, vars as TVars)
        setExtraWindows(w => [{vars}, ...w])
      } finally {
        setLoadingMore(false)
      }
    },
    [client, doc, extraWindows, pageSize]
  )

  const jumpTo = useCallback(
    async (cursor: string, n?: number) => {
      const base = baseRef.current
      const vars = {
        ...base,
        ...(conn.first ? {[conn.first]: n ?? pageSize} : {}),
        ...(conn.after ? {[conn.after]: cursor} : {})
      }
      setLoadingMore(true)
      try {
        await client.fetch(doc, vars as TVars)
        setExtraWindows([{vars}])
      } finally {
        setLoadingMore(false)
      }
    },
    [client, doc, pageSize]
  )

  // ── read + merge (Suspense on the first window) ────────────────────────────
  const base = baseVars()
  const windows = allWindows(base)

  // First window: suspend on miss.
  const firstKey = opKey(doc, windows[0].vars)
  const firstRead = client.ensure(doc, windows[0].vars as TVars)
  if (firstRead.error !== undefined) throw firstRead.error
  if (firstRead.promise) throw firstRead.promise

  // Merge edges across all windows that already have data. All reads go through
  // the deref-aware wrapped connection (so normalized intermediates resolve).
  const mergedEdges: any[] = []
  const seenCursors = new Set<string>()
  let firstConn: any
  let lastConn: any
  let totalCount: number | undefined

  windows.forEach((w, idx) => {
    const data =
      idx === 0 ? firstRead.data : client.store.get(opKey(doc, w.vars))?.data
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
  // keep the unused key reference meaningful for debugging
  void firstKey

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
    loadNext,
    loadPrev,
    jumpTo,
    isLoadingMore
  }
}
