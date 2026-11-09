/**
 * Snowflake node-id lease — `useDatabase({nodeId: 'lease'})`.
 *
 * A snowflake node id must be unique across every process writing to the SAME
 * database (they share one id space), so the database is the natural coordinator.
 * On boot each instance atomically claims the lowest free (or stale) slot in a
 * small `_pylon_nodes` ledger and heartbeats to hold it; a crashed instance's
 * slot goes stale after the TTL and is reclaimed. This makes multi-instance
 * deploys (PM2 cluster, multiple hosts) collision-free with zero config and no
 * `PYLON_NODE_ID` env — the classic "everyone defaults to node 0" trap.
 */
import {randomBytes} from 'node:crypto'
import {hostname} from 'node:os'
import {sql} from 'kysely'
import type {Database} from './database.js'

const LEASE_TABLE = '_pylon_nodes'
// Distinct from the migration advisory-lock key — serializes concurrent claims.
const LEASE_LOCK_KEY = 0x70_79_6c_6e // 'pyln'

export interface NodeLeaseOptions {
  /** Highest assignable node id (inclusive). Defaults to 1023 (10-bit snowflake). */
  max?: number
  /** Seconds before an un-heartbeated slot is considered stale/reclaimable. Default 60. */
  ttlSeconds?: number
}

export interface NodeLease {
  /** The claimed node id (0..max). */
  nodeId: number
  /** Stop heartbeating and free the slot (best-effort). Idempotent. */
  release: () => Promise<void>
}

async function claimSlot(
  db: Database,
  owner: string,
  max: number,
  ttlSeconds: number
): Promise<number> {
  return db.kysely.transaction().execute(async trx => {
    // Serialize all claimants (across instances) on one DB-global lock; it's
    // transaction-scoped, so it auto-releases on commit — no manual unlock.
    await sql`SELECT pg_advisory_xact_lock(${LEASE_LOCK_KEY})`.execute(trx)
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(LEASE_TABLE)} (
        node_id integer PRIMARY KEY,
        owner text NOT NULL,
        host text,
        pid integer,
        heartbeat_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(trx)
    // Lowest id with no LIVE occupant (missing row, or heartbeat older than TTL).
    const found = await sql<{node_id: number}>`
      SELECT gs AS node_id
      FROM generate_series(0, ${max}) AS gs
      WHERE NOT EXISTS (
        SELECT 1 FROM ${sql.ref(LEASE_TABLE)} p
        WHERE p.node_id = gs AND p.heartbeat_at > now() - make_interval(secs => ${ttlSeconds})
      )
      ORDER BY gs
      LIMIT 1
    `.execute(trx)
    const nodeId = found.rows[0]?.node_id
    if (nodeId == null) {
      throw new Error(`snowflake node-id lease: all ${max + 1} slots are live`)
    }
    await sql`
      INSERT INTO ${sql.ref(LEASE_TABLE)} (node_id, owner, host, pid, heartbeat_at)
      VALUES (${nodeId}, ${owner}, ${hostname()}, ${process.pid}, now())
      ON CONFLICT (node_id) DO UPDATE SET
        owner = EXCLUDED.owner, host = EXCLUDED.host, pid = EXCLUDED.pid, heartbeat_at = now()
    `.execute(trx)
    return nodeId
  })
}

/**
 * Claim a unique snowflake node id from the database and hold it with a
 * heartbeat. Returns the id + a `release`. The heartbeat timer is `unref`'d, so
 * it never keeps the process alive.
 */
export async function leaseNodeId(
  db: Database,
  options: NodeLeaseOptions = {}
): Promise<NodeLease> {
  const max = options.max ?? 1023
  const ttlSeconds = options.ttlSeconds ?? 60
  const owner = `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`

  const nodeId = await claimSlot(db, owner, max, ttlSeconds)

  const period = Math.max(1000, Math.floor((ttlSeconds * 1000) / 3))
  const timer = setInterval(() => {
    // Transient DB blips are swallowed — the TTL still protects the slot, and
    // the next successful beat re-holds it.
    void sql`
      UPDATE ${sql.ref(LEASE_TABLE)} SET heartbeat_at = now()
      WHERE node_id = ${nodeId} AND owner = ${owner}
    `
      .execute(db.kysely)
      .catch(() => {})
  }, period)
  timer.unref?.()

  let released = false
  const release = async () => {
    if (released) return
    released = true
    clearInterval(timer)
    await sql`
      DELETE FROM ${sql.ref(LEASE_TABLE)} WHERE node_id = ${nodeId} AND owner = ${owner}
    `
      .execute(db.kysely)
      .catch(() => {})
  }

  return {nodeId, release}
}
