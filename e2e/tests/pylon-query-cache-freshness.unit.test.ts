/**
 * Navigation staleness / refetch-loop behavior, now owned by pylon-query's store
 * instead of gqty's Cache. The client serves cached data instantly and decides
 * whether to revalidate based on a freshness window (`freshMs`):
 *
 *  - within the window  → re-read serves data and does NOT revalidate (this is
 *    what broke the old `maxAge: 0` refetch loop — a fresh window stops it), and
 *  - once stale          → re-read still serves instantly AND kicks a background
 *    revalidation (so other-page / backend changes show up on navigation).
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
  it('within the freshness window, a re-read does NOT revalidate (loop broken)', async () => {
    const fetcher = vi.fn(async () => ({data: {hello: 'world'}}))
    const client = createPylonQueryClient({fetcher: fetcher as any, freshMs: 60_000})

    await client.fetch(D)
    const read = client.ensure(D)
    expect(read.data).toEqual({hello: 'world'}) // served instantly
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1) // fresh → no revalidation
  })

  it('once stale, a re-read serves instantly AND revalidates in the background', async () => {
    const fetcher = vi.fn(async () => ({data: {hello: 'world'}}))
    const client = createPylonQueryClient({fetcher: fetcher as any, freshMs: 0})

    await client.fetch(D)
    const read = client.ensure(D)
    expect(read.data).toEqual({hello: 'world'}) // still served instantly (no flash)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)) // revalidated
  })
})
