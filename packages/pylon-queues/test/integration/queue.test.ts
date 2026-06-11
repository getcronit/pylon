/**
 * Core queue behavior against a real Redis (docker-compose.yml → 6380).
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {closeConnection, defineQueue, setConnection} from '../../src/index'

const REDIS = process.env.REDIS_URL ?? 'redis://localhost:6380'
const runRedis = process.env.REDIS_URL || process.env.PYLON_QUEUES_IT

describe.skipIf(!runRedis)('queues (Redis)', () => {
  beforeAll(() => setConnection(REDIS))
  afterAll(() => closeConnection())

  it('enqueues and processes a typed job', async () => {
    const q = defineQueue<{n: number}>(`double-${Date.now()}`, {concurrency: 2})
    const out: number[] = []
    const done = new Promise<void>(resolve => {
      q.process(({data}) => {
        out.push(data.n * 2)
        resolve()
      })
    })
    q.startWorker()
    await q.add({n: 21})
    await done
    expect(out).toEqual([42])
    await q.close()
  })

  it('validates job data against the schema on enqueue', async () => {
    const q = defineQueue<{id: string}>(`val-${Date.now()}`, {
      schema: {
        parse(d: any) {
          if (typeof d?.id !== 'string') throw new Error('id must be a string')
          return d
        }
      }
    })
    await expect(q.add({id: 123 as any})).rejects.toThrow(/id must be a string/)
    await q.close()
  })

  it('retries a failing job up to `attempts`', async () => {
    const q = defineQueue<{x: number}>(`retry-${Date.now()}`, {
      attempts: 3,
      backoff: {type: 'fixed', delay: 10}
    })
    let tries = 0
    const succeeded = new Promise<void>(resolve => {
      q.process(() => {
        tries++
        if (tries < 3) throw new Error('transient')
        resolve()
      })
    })
    q.startWorker()
    await q.add({x: 1})
    await succeeded
    expect(tries).toBe(3) // failed twice, succeeded on the 3rd attempt
    await q.close()
  })
})
