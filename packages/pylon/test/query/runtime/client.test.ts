import {describe, expect, it, vi} from 'vitest'
import {createPylonQueryClient} from '@/query/runtime/client'
import {doc, opKey} from '@/query/runtime/doc'

const D = doc<{me: {name: string}}>({
  id: 'q_test',
  body: 'query Test { me { name } }',
  name: 'Test'
})

const makeClient = (data: any) => {
  const fetcher = vi.fn(async () => ({data}))
  const client = createPylonQueryClient({fetcher: fetcher as any})
  return {client, fetcher}
}

describe('PylonQueryClient', () => {
  it('ensure() returns a promise on miss, then cached data', async () => {
    const {client, fetcher} = makeClient({me: {name: 'Ada'}})
    const first = client.ensure(D)
    expect(first.promise).toBeInstanceOf(Promise)
    await first.promise
    const second = client.ensure(D)
    expect(second.data).toEqual({me: {name: 'Ada'}})
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent identical fetches', async () => {
    const {client, fetcher} = makeClient({me: {name: 'Ada'}})
    const a = client.fetch(D)
    const b = client.fetch(D)
    expect(a).toBe(b)
    await a
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('collect() snapshots resolved data; hydrate() seeds a fresh client', async () => {
    const {client} = makeClient({me: {name: 'Ada'}})
    await client.fetch(D)
    const snapshot = client.collect()
    expect(Object.values(snapshot.ops)).toContainEqual({me: {name: 'Ada'}})

    const {client: client2, fetcher: fetcher2} = makeClient({me: {name: 'X'}})
    client2.hydrate(snapshot)
    const read = client2.ensure(D)
    expect(read.data).toEqual({me: {name: 'Ada'}})
    expect(fetcher2).not.toHaveBeenCalled()
  })

  it('ensure() is render-pure: never revalidates cached data, even when stale', async () => {
    // freshMs:0 → every cached entry is immediately "stale". ensure() must still
    // serve it WITHOUT refetching — otherwise every render (and every unrelated
    // mutation re-render) would trigger a request storm.
    const fetcher = vi.fn(async () => ({data: {me: {name: 'Ada'}}}))
    const client = createPylonQueryClient({fetcher: fetcher as any, freshMs: 0})
    await client.fetch(D)
    expect(fetcher).toHaveBeenCalledTimes(1)
    client.ensure(D)
    client.ensure(D)
    expect(fetcher).toHaveBeenCalledTimes(1) // no render-time revalidation
  })

  it('revalidate() refetches stale data in the background (mount/key effect)', async () => {
    const fetcher = vi.fn(async () => ({data: {me: {name: 'Ada'}}}))
    const client = createPylonQueryClient({fetcher: fetcher as any, freshMs: 0})
    await client.fetch(D)
    expect(fetcher).toHaveBeenCalledTimes(1)
    client.revalidate(D)
    expect(fetcher).toHaveBeenCalledTimes(2) // stale → background refetch
  })

  it('revalidate() leaves fresh data untouched', async () => {
    const fetcher = vi.fn(async () => ({data: {me: {name: 'Ada'}}}))
    const client = createPylonQueryClient({fetcher: fetcher as any, freshMs: 60_000})
    await client.fetch(D)
    client.revalidate(D)
    expect(fetcher).toHaveBeenCalledTimes(1) // still fresh → no refetch
  })

  it('surfaces GraphQL errors when NO data comes back (total failure)', async () => {
    const fetcher = vi.fn(async () => ({errors: [{message: 'boom'}]}))
    const client = createPylonQueryClient({fetcher: fetcher as any})
    await expect(client.fetch(D)).rejects.toThrow('boom')
  })

  // ── completeness gate ──────────────────────────────────────────────────────
  // A component must only render an operation whose ENTIRE selection is present
  // in the store. This is the root fix for partial reads: a shared entity that
  // another op populated without a field THIS op selected must NOT be served — it
  // suspends and refetches instead of handing component code a `undefined` hole.

  const WIDE = doc<{ticket: {id: string; timeline: {totalCount: number}}}>({
    id: 'q_wide',
    body: 'query Wide { ticket { id timeline { totalCount __typename } __typename } }',
    name: 'Wide',
    shape: [
      {
        k: 'ticket',
        s: [{k: 'id'}, {k: 'timeline', s: [{k: 'totalCount'}]}]
      }
    ]
  })

  it('ensure() suspends when the cached op is present but INCOMPLETE (shared entity missing a selected field)', async () => {
    const full = {ticket: {__typename: 'Ticket', id: '1', timeline: {totalCount: 3}}}
    const fetcher = vi.fn(async () => ({data: full}))
    const client = createPylonQueryClient({fetcher: fetcher as any})
    // Seed as if a NARROWER op had populated Ticket:1 without `timeline`, and
    // WIDE's op-root (a ref tree) was hydrated pointing at it.
    client.hydrate({
      ops: {[opKey(WIDE, undefined)]: {ticket: {__ref: 'Ticket:1'}}},
      entities: {'Ticket:1': {__typename: 'Ticket', id: '1'}}
    })

    // Incomplete → must NOT hand back the hole; suspends on a refetch.
    const first = client.ensure(WIDE)
    expect(first.data).toBeUndefined()
    expect(first.promise).toBeInstanceOf(Promise)
    await first.promise

    // Refetch filled the entity → now complete → serves data (no hole).
    const second = client.ensure(WIDE)
    expect(second.promise).toBeUndefined()
    expect((second.data as any).ticket.__ref ?? (second.data as any).ticket).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('ensure() serves COMPLETE data without suspending, even when stale (no over-suspend flash)', async () => {
    const fetcher = vi.fn(async () => ({data: {ticket: {__typename: 'Ticket', id: '1', timeline: {totalCount: 3}}}}))
    const client = createPylonQueryClient({fetcher: fetcher as any, freshMs: 0})
    // Fully-satisfying entity already in the store, stale (freshMs:0).
    client.hydrate({
      ops: {[opKey(WIDE, undefined)]: {ticket: {__ref: 'Ticket:1'}}},
      entities: {'Ticket:1': {__typename: 'Ticket', id: '1', timeline: {totalCount: 3, __typename: 'Timeline'}}}
    })
    const read = client.ensure(WIDE)
    expect(read.promise).toBeUndefined()
    expect(read.data).toBeDefined()
    expect(fetcher).not.toHaveBeenCalled() // complete-but-stale never suspends/refetches at read time
  })

  it('ensure() does not loop when a refetch cannot complete the op (serves what it has)', async () => {
    // Pathological: the fetch never fills `timeline`. Gate must refetch AT MOST
    // once, then serve the incomplete data rather than suspending forever.
    const fetcher = vi.fn(async () => ({data: {ticket: {__typename: 'Ticket', id: '1'}}}))
    const client = createPylonQueryClient({fetcher: fetcher as any})
    client.hydrate({
      ops: {[opKey(WIDE, undefined)]: {ticket: {__ref: 'Ticket:1'}}},
      entities: {'Ticket:1': {__typename: 'Ticket', id: '1'}}
    })
    const first = client.ensure(WIDE)
    expect(first.promise).toBeInstanceOf(Promise)
    await first.promise
    const second = client.ensure(WIDE)
    expect(second.data).toBeDefined() // served, not suspended
    expect(fetcher).toHaveBeenCalledTimes(1) // exactly one completeness refetch
  })

  it('tolerates partial data alongside field errors (feature gating)', async () => {
    // A gated field (`tickets`) throws while its siblings resolve — GraphQL
    // returns partial `data` + `errors`. The op must NOT fail: good data is
    // cached and the errored field is simply `null`.
    const M = doc<{tasks: {id: string} | null; tickets: {id: string} | null}>({
      id: 'q_partial',
      body: 'query Partial { tasks { id } tickets { id } }',
      name: 'Partial'
    })
    const fetcher = vi.fn(async () => ({
      data: {tasks: {id: 't1'}, tickets: null},
      errors: [{message: 'Feature "tickets" is not enabled for this tenant.'}]
    }))
    const client = createPylonQueryClient({fetcher: fetcher as any})
    const res = (await client.fetch(M)) as any
    expect(res.tasks).toEqual({id: 't1'})
    expect(res.tickets).toBeNull()
    // Cached and readable without throwing.
    const read = client.ensure(M)
    expect('error' in read).toBe(false)
    expect((read as any).data.tasks).toEqual({id: 't1'})
  })
})
