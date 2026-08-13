/**
 * Transactional outbox — `queue.add()` inside a DB transaction is enqueued IFF
 * the transaction commits (no phantom jobs on rollback). Needs Postgres + Redis.
 */
import {connect, type Database, setDefaultDatabase} from '@getcronit/pylon/db'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  closeConnection,
  createPgOutbox,
  defineQueue,
  relayOnce,
  setConnection,
  setOutboxDriver
} from '@/queues/index'

const REDIS = process.env.REDIS_URL ?? 'redis://localhost:6380'
const PG = process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const run = process.env.PYLON_QUEUES_IT || process.env.DATABASE_URL

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error('timeout waiting for condition')
}

describe.skipIf(!run)('transactional outbox (Postgres + Redis)', () => {
  let db: Database
  beforeAll(async () => {
    setConnection(REDIS)
    db = connect({connectionString: PG})
    await db.kysely.schema.dropTable('_pylon_outbox').ifExists().execute()
    setOutboxDriver(await createPgOutbox()) // creates the table
  })
  afterAll(async () => {
    await db.kysely.schema.dropTable('_pylon_outbox').ifExists().execute()
    setOutboxDriver(undefined)
    await db.destroy()
    setDefaultDatabase(undefined)
    await closeConnection()
  })

  it('enqueues on COMMIT (via the outbox + relay), never directly during the txn', async () => {
    const q = defineQueue<{v: number}>(`ob-commit-${Date.now()}`)
    const seen: number[] = []
    q.process(({data}) => {
      seen.push(data.v)
    })
    q.startWorker()

    await db.transaction(async () => {
      await q.add({v: 1}) // → outbox row in this txn, NOT Redis
    })
    // the row is committed in the outbox; nothing has reached Redis/the worker yet
    expect(seen).toEqual([])

    const relayed = await relayOnce() // drain committed rows → Redis
    expect(relayed).toBe(1)
    await waitFor(() => seen.includes(1))
    expect(seen).toEqual([1])

    await q.close()
  })

  it('does NOT enqueue on ROLLBACK (no phantom job)', async () => {
    const q = defineQueue<{v: number}>(`ob-rollback-${Date.now()}`)
    const seen: number[] = []
    q.process(({data}) => {
      seen.push(data.v)
    })
    q.startWorker()

    await db
      .transaction(async () => {
        await q.add({v: 2}) // outbox row, but...
        throw new Error('boom') // ...the txn rolls back → row vanishes
      })
      .catch(() => {})

    expect(await relayOnce()).toBe(0) // nothing committed → nothing to relay
    await new Promise(r => setTimeout(r, 200))
    expect(seen).toEqual([]) // the job was never enqueued

    await q.close()
  })

  it('outside a transaction, add() goes straight to Redis (no relay needed)', async () => {
    const q = defineQueue<{v: number}>(`ob-direct-${Date.now()}`)
    const seen: number[] = []
    q.process(({data}) => {
      seen.push(data.v)
    })
    q.startWorker()
    await db.run(async () => {
      await q.add({v: 3}) // no txn → direct enqueue
    })
    await waitFor(() => seen.includes(3))
    expect(seen).toEqual([3])
    await q.close()
  })
})
