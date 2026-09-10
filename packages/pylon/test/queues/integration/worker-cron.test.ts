/**
 * cron (repeatable) jobs + the register/start split + useQueues in-process mode.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  closeConnection,
  cron,
  setConnection,
  startWorkers
} from '@/queues/index'
import {createQueue} from '@/queues/queue'

const REDIS = process.env.REDIS_URL ?? 'redis://localhost:6380'
const run = process.env.PYLON_QUEUES_IT || process.env.REDIS_URL

const waitFor = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error('timeout')
}

describe.skipIf(!run)('cron + worker start (Redis)', () => {
  beforeAll(() => setConnection(REDIS))
  afterAll(() => closeConnection())

  it('process() registers but does NOT consume until startWorker()', async () => {
    const q = createQueue<{v: number}>(`reg-${Date.now()}`)
    const seen: number[] = []
    q.process(({data}) => {
      seen.push(data.v)
    })
    await q.add({v: 1})
    // not started → nothing consumed
    await new Promise(r => setTimeout(r, 150))
    expect(seen).toEqual([])
    // now start
    q.startWorker()
    await waitFor(() => seen.includes(1))
    expect(seen).toEqual([1])
    await q.close()
  })

  it('cron() runs on a repeat schedule once workers start', async () => {
    let ticks = 0
    const q = cron(`tick-${Date.now()}`, '* * * * * *', () => {
      ticks++
    }) // every second
    await startWorkers() // starts this (+ any other) worker and schedules the repeat
    await waitFor(() => ticks >= 2, 5000) // fires repeatedly
    expect(ticks).toBeGreaterThanOrEqual(2)
    await q.close()
  })
})
