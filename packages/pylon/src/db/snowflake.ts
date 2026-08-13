/**
 * Snowflake id generator — a numeric, time-ordered, coordination-free id in the
 * shape used by Twitter/Discord/Shopify. A 64-bit integer packs the moment it
 * was minted into its high bits, so ids are compact and roughly sortable by
 * creation time, yet each process mints them independently (no central counter)
 * given a unique `nodeId`. Use as a function default on a `text` (or `bigint`)
 * primary key:
 *
 * ```ts
 * class Order extends Model {
 *   id = text({primaryKey: true, default: snowflake()})
 * }
 * ```
 *
 * The value is returned as a decimal **string** (like Shopify/Discord ids): a
 * 64-bit snowflake exceeds `Number.MAX_SAFE_INTEGER`, so passing it around as a
 * JS `number` would silently lose precision. Decode one with `decodeSnowflake`.
 *
 * Bit layout (64 bits): `41` ms since `epoch` | `10` node id | `12` sequence.
 * That yields 1024 nodes and 4096 ids per node per millisecond, and ~69 years
 * of range from the epoch.
 */

const NODE_BITS = 10n
const SEQ_BITS = 12n
const MAX_NODE = (1n << NODE_BITS) - 1n // 1023
const MAX_SEQ = (1n << SEQ_BITS) - 1n // 4095
const TS_SHIFT = NODE_BITS + SEQ_BITS // 22
const NODE_SHIFT = SEQ_BITS // 12

/** Default epoch: 2020-01-01T00:00:00Z. Keeps the 41-bit range usable to ~2090. */
export const DEFAULT_SNOWFLAKE_EPOCH = 1577836800000

export interface SnowflakeOptions {
  /**
   * 10-bit node id (0..1023) — must be unique per concurrently-writing process
   * so ids from different nodes can never collide. Defaults to the
   * `PYLON_NODE_ID` env var, else `0`.
   */
  nodeId?: number
  /** Custom epoch in ms (e.g. to match imported Twitter/Discord ids). */
  epoch?: number
}

/** Stateful allocator: one clock+sequence shared per node so ids stay unique. */
interface Allocator {
  epoch: bigint
  next(): bigint
}

// Share allocator state per node id: two columns/tables minting on the same node
// in the same millisecond must draw from ONE sequence counter, or they'd both
// emit sequence 0 and collide. Different node ids never collide by construction.
const allocators = new Map<number, Allocator>()

function resolveNodeId(nodeId?: number): number {
  const raw = nodeId ?? (process.env.PYLON_NODE_ID ? Number(process.env.PYLON_NODE_ID) : 0)
  if (!Number.isInteger(raw) || raw < 0 || BigInt(raw) > MAX_NODE) {
    throw new Error(`snowflake: nodeId must be an integer in 0..1023, got ${raw}`)
  }
  return raw
}

function allocatorFor(nodeId: number, epoch: number): Allocator {
  const existing = allocators.get(nodeId)
  if (existing) {
    if (existing.epoch !== BigInt(epoch)) {
      throw new Error(
        `snowflake: node ${nodeId} is already in use with a different epoch — ` +
          `reusing a node id with a mismatched epoch can produce colliding ids`
      )
    }
    return existing
  }
  const node = BigInt(nodeId)
  const epochBig = BigInt(epoch)
  let lastTs = -1n
  let seq = 0n
  const alloc: Allocator = {
    epoch: epochBig,
    next(): bigint {
      let now = BigInt(Date.now())
      // Clock moved backwards (NTP step): wait it out rather than risk a dup id.
      while (now < lastTs) now = BigInt(Date.now())
      if (now === lastTs) {
        seq = (seq + 1n) & MAX_SEQ
        // Overflowed 4096 ids this ms — spin to the next millisecond.
        if (seq === 0n) do now = BigInt(Date.now())
        while (now <= lastTs)
      } else {
        seq = 0n
      }
      lastTs = now
      return ((now - epochBig) << TS_SHIFT) | (node << NODE_SHIFT) | seq
    }
  }
  allocators.set(nodeId, alloc)
  return alloc
}

/**
 * Build a Snowflake id generator. Returns a `() => string` suitable as a
 * `default` on a text/bigint primary key. Generators sharing a `nodeId` share
 * one clock+sequence, so ids are globally unique across every model on the node.
 */
export function snowflake(options: SnowflakeOptions = {}): () => string {
  const nodeId = resolveNodeId(options.nodeId)
  const epoch = options.epoch ?? DEFAULT_SNOWFLAKE_EPOCH
  const alloc = allocatorFor(nodeId, epoch)
  return () => alloc.next().toString()
}

// ── Process-configured node id (set by `useDatabase({nodeId})`) ───────────────
// The single node id for `id({snowflake:true})` PKs. Read lazily at insert time
// (not at model-definition time), so `useDatabase.setup()` can set it from config
// before the first row is created — no `PYLON_NODE_ID` env dependency.
let configuredNodeId = 0

/** Set the process-wide snowflake node id (0..1023). Called by `useDatabase`. */
export function setSnowflakeNodeId(nodeId: number): void {
  configuredNodeId = resolveNodeId(nodeId)
}

/** The current process node id. */
export function snowflakeNodeId(): number {
  return configuredNodeId
}

/**
 * The default generator behind `id({snowflake: true})`. Draws from the shared
 * allocator for the *currently configured* node id, so every snowflake PK in the
 * process shares one clock+sequence (globally unique) and picks up the node id
 * that `useDatabase` set at boot.
 */
export function snowflakeDefault(): string {
  return allocatorFor(configuredNodeId, DEFAULT_SNOWFLAKE_EPOCH).next().toString()
}

/**
 * Validate that a value is a well-formed snowflake — a positive, unsigned-64-bit
 * decimal string. Returns `true` or an error message (the `FieldOptions.validate`
 * contract). The generator's own output always passes; this guards user-supplied
 * ids on `id({snowflake: true})`.
 */
export function isSnowflakeString(value: unknown): true | string {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) {
    return 'must be a snowflake id (a numeric string)'
  }
  let n: bigint
  try {
    n = BigInt(value)
  } catch {
    return 'must be a snowflake id (a numeric string)'
  }
  if (n <= 0n || n >= 1n << 64n) return 'snowflake id out of 64-bit range'
  return true
}

export interface DecodedSnowflake {
  /** Epoch-relative ms embedded in the id. */
  timestamp: number
  /** Wall-clock creation time (`epoch + timestamp`). */
  date: Date
  nodeId: number
  sequence: number
}

/**
 * Unpack a snowflake string back into its parts — handy for debugging or to
 * recover an entity's creation time straight from its id.
 */
export function decodeSnowflake(
  id: string | bigint,
  epoch: number = DEFAULT_SNOWFLAKE_EPOCH
): DecodedSnowflake {
  const n = BigInt(id)
  const timestamp = Number(n >> TS_SHIFT)
  return {
    timestamp,
    date: new Date(timestamp + epoch),
    nodeId: Number((n >> NODE_SHIFT) & MAX_NODE),
    sequence: Number(n & MAX_SEQ)
  }
}
