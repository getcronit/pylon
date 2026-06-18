/**
 * Navigation staleness fix (build-client.ts): the browser gqty cache was configured
 * `maxAge: Infinity` despite a comment describing immediate-expiry SWR. Infinity means
 * a cached entry NEVER expires — so on client-side navigation `useQuery` re-reads it
 * and, finding it fresh, never revalidates → stale data forever (added-on-another-page
 * / backend-changed never shows). The fix is `maxAge: 0` (the documented intent): the
 * entry is served instantly but treated as stale, so navigation/mount revalidates.
 *
 * This pins the freshness DECISION the gqty cache makes (what `useQuery` consults to
 * decide refetch) — deterministically, without a browser. (The end-to-end "navigate →
 * refetch" is `useQuery` acting on this; a browser test would cover that layer.)
 */
import {Cache} from 'gqty'
import {describe, expect, it} from 'vitest'

// Same options Pylon ships for the browser client (see build-client.ts).
const SWR = 5 * 60 * 1000

function entry(maxAge: number) {
  const cache = new Cache(undefined, {maxAge, staleWhileRevalidate: SWR, normalization: true})
  cache.set({query: {hello: 'world'}})
  return cache.get('query.hello') as {
    data: unknown
    expiresAt: number | null
    swrBefore: number | null
  }
}

describe('gqty browser cache freshness (navigation staleness fix)', () => {
  it('OLD maxAge:Infinity → entry NEVER expires (stale on navigation, the bug)', () => {
    const e = entry(Infinity)
    expect(e.data).toBe('world')
    // No FINITE expiry (null or Infinity, depending on gqty build) = fresh forever →
    // useQuery never revalidates → stale data persists across navigation.
    expect(Number.isFinite(e.expiresAt as number)).toBe(false)
  })

  it('NEW maxAge:0 → entry has an immediate finite expiry but an SWR window (revalidates)', () => {
    const now = Date.now()
    const e = entry(0)
    expect(e.data).toBe('world')
    // A concrete expiry ~now → the entry is (almost) immediately stale → useQuery
    // revalidates on mount/navigation, picking up other-page/backend changes.
    expect(Number.isFinite(e.expiresAt as number)).toBe(true)
    expect((e.expiresAt as number) - now).toBeLessThan(1000)
    // ...yet still served instantly within the staleWhileRevalidate window (no flash).
    expect(Number.isFinite(e.swrBefore as number)).toBe(true)
    expect((e.swrBefore as number)).toBeGreaterThan(now)
  })
})
