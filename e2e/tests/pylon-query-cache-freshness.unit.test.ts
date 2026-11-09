/**
 * Navigation staleness / refetch-loop behavior, now owned by pylon-query's store
 * instead of gqty's Cache. Reads are render-pure: `ensure()` serves cached data
 * and NEVER revalidates on its own (so one unrelated mutation can't refetch every
 * mounted query). Background revalidation is an EFFECT — `revalidate()`, called on
 * mount / variables-change — gated by a freshness window (`freshMs`):
 *
 *  - within the window → revalidate() serves data and does NOT refetch (this is
 *    what broke the old `maxAge: 0` refetch loop — a fresh window stops it), and
 *  - once stale         → the cached entry is still served instantly AND
 *    revalidate() kicks a background refetch (so other-page / backend changes show
 *    up on navigation).
 *
 * This pins that decision deterministically, without a browser, by observing how
 * many times the transport is invoked.
 */
import {createPylonQueryClient, doc} from '@getcronit/pylon/query'
import {describe, expect, it, vi} from 'vitest'

const D = doc<{hello: string}>({
  id: 'q_hello',
  body: 'query Q { hello }',
  name: 'Q'
})

describe('pylon-query store freshness (navigation staleness / loop fix)', () => {
  it('within the freshness window, revalidate() does NOT refetch (loop broken)', async () => {
    const fetcher = vi.fn(async () => ({data: {hello: 'world'}}))
    const client = createPylonQueryClient({fetcher: fetcher as any, freshMs: 60_000})

    await client.fetch(D)
    const read = client.ensure(D)
    expect(read.data).toEqual({hello: 'world'}) // served instantly
    client.revalidate(D) // mount effect — fresh window → no refetch
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1) // fresh → no revalidation
  })

  it('once stale, the entry serves instantly AND revalidate() refetches in the background', async () => {
    const fetcher = vi.fn(async () => ({data: {hello: 'world'}}))
    const client = createPylonQueryClient({fetcher: fetcher as any, freshMs: 0})

    await client.fetch(D)
    const read = client.ensure(D)
    expect(read.data).toEqual({hello: 'world'}) // still served instantly (no flash)
    client.revalidate(D) // mount effect — stale → background refetch
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)) // revalidated
  })
})
