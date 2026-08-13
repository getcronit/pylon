/**
 * Snowflake node-id lease (`useDatabase({nodeId:'lease'})`) — atomic per-database
 * slot allocation with heartbeat + stale reclaim. Needs a live Postgres.
 */
import {afterEach, beforeAll, afterAll, describe, expect, it} from 'vitest'
import {sql} from 'kysely'
import {connect, type Database, leaseNodeId, setDefaultDatabase} from '../../src/index'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('leaseNodeId (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
  })
  afterEach(async () => {
    await db.kysely.schema.dropTable('_pylon_nodes').ifExists().cascade().execute()
  })
  afterAll(async () => {
    if (db) await db.destroy()
    setDefaultDatabase(undefined)
  })

  it('hands out distinct, lowest-free node ids', async () => {
    const a = await leaseNodeId(db)
    const b = await leaseNodeId(db)
    const c = await leaseNodeId(db)
    expect([a.nodeId, b.nodeId, c.nodeId]).toEqual([0, 1, 2])
    await a.release()
    await b.release()
    await c.release()
  })

  it('reclaims a released slot (reuses the lowest free)', async () => {
    const a = await leaseNodeId(db) // 0
    const b = await leaseNodeId(db) // 1
    await a.release() // frees 0
    const c = await leaseNodeId(db) // 0 again
    expect(c.nodeId).toBe(0)
    await b.release()
    await c.release()
  })

  it('reclaims a STALE slot (crashed instance, no heartbeat)', async () => {
    // Simulate a crashed owner: a live-looking row whose heartbeat is long past.
    await sql`
      CREATE TABLE IF NOT EXISTS _pylon_nodes (
        node_id integer PRIMARY KEY, owner text NOT NULL, host text, pid integer,
        heartbeat_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db.kysely)
    await sql`
      INSERT INTO _pylon_nodes (node_id, owner, heartbeat_at)
      VALUES (0, 'ghost', now() - interval '10 minutes')
    `.execute(db.kysely)

    // Default TTL (60s) → the 10-min-old slot 0 is stale and reclaimed.
    const a = await leaseNodeId(db)
    expect(a.nodeId).toBe(0)
    await a.release()
  })

  it('does not steal a FRESH slot held by another owner', async () => {
    const held = await leaseNodeId(db) // 0, heartbeating
    const next = await leaseNodeId(db) // must skip 0 → 1
    expect(held.nodeId).toBe(0)
    expect(next.nodeId).toBe(1)
    await held.release()
    await next.release()
  })
})
