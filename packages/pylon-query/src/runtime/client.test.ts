import {describe, expect, it, vi} from 'vitest'
import {createPylonQueryClient} from './client'
import {doc} from './doc'

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
    expect(Object.values(snapshot)).toContainEqual({me: {name: 'Ada'}})

    const {client: client2, fetcher: fetcher2} = makeClient({me: {name: 'X'}})
    client2.hydrate(snapshot)
    const read = client2.ensure(D)
    expect(read.data).toEqual({me: {name: 'Ada'}})
    expect(fetcher2).not.toHaveBeenCalled()
  })

  it('surfaces GraphQL errors', async () => {
    const fetcher = vi.fn(async () => ({errors: [{message: 'boom'}]}))
    const client = createPylonQueryClient({fetcher: fetcher as any})
    await expect(client.fetch(D)).rejects.toThrow('boom')
  })
})
