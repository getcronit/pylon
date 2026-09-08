import {describe, expect, it, vi} from 'vitest'

import {Store} from '@/query/runtime/store'

/**
 * The store half of `useIsFetching`.
 *
 * The hook's own delay and minimum-duration are timing policy; what has to be
 * right here is that a fetch STARTING is observable at all. It was not: the
 * write that records it is silent, so subscribers only ever saw fetches end.
 */
describe('Store in-flight tracking', () => {
  it('reports nothing in flight to begin with', () => {
    expect(new Store().isFetching()).toBe(false)
  })

  it('reports a fetch that has begun', () => {
    const store = new Store()
    store.beginFetch('op:1')
    expect(store.isFetching()).toBe(true)
  })

  it('notifies subscribers that a fetch began', async () => {
    const store = new Store()
    const seen = vi.fn()
    store.subscribe(seen)

    store.beginFetch('op:1')
    // Deliberately deferred: `ensure()` runs during render, and emitting there
    // is what the silent write was avoiding.
    expect(seen).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(seen).toHaveBeenCalled()
  })

  it('stays fetching until every operation settles', async () => {
    const store = new Store()
    store.beginFetch('op:1')
    store.beginFetch('op:2')
    await Promise.resolve()

    store.endFetch('op:1')
    expect(store.isFetching()).toBe(true)

    store.endFetch('op:2')
    expect(store.isFetching()).toBe(false)
  })

  it('counts one operation once, however often it is announced', async () => {
    const store = new Store()
    store.beginFetch('op:1')
    store.beginFetch('op:1')
    await Promise.resolve()

    store.endFetch('op:1')
    expect(store.isFetching()).toBe(false)
  })

  it('ignores an end for something that never began', () => {
    const store = new Store()
    const seen = vi.fn()
    store.subscribe(seen)
    store.endFetch('never-started')
    expect(seen).not.toHaveBeenCalled()
    expect(store.isFetching()).toBe(false)
  })
})
