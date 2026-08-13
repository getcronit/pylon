/**
 * Snowflake id generator — numeric, time-ordered, coordination-free ids.
 */
import {afterEach, describe, expect, it} from 'vitest'
import {
  DEFAULT_SNOWFLAKE_EPOCH,
  decodeSnowflake,
  isSnowflakeString,
  setSnowflakeNodeId,
  snowflake,
  snowflakeDefault,
  snowflakeNodeId
} from '../src/snowflake'

// Each test picks a distinct nodeId so the shared per-node allocator state
// never bleeds between cases.
afterEach(() => {
  delete process.env.PYLON_NODE_ID
})

describe('snowflake()', () => {
  it('returns a decimal string that parses to a positive 64-bit int', () => {
    const gen = snowflake({nodeId: 1})
    const id = gen()
    expect(id).toMatch(/^[0-9]+$/)
    const n = BigInt(id)
    expect(n).toBeGreaterThan(0n)
    expect(n).toBeLessThan(1n << 64n)
    // Not a safe JS number — this is why we return a string.
    expect(n).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER))
  })

  it('is monotonically increasing within a node', () => {
    const gen = snowflake({nodeId: 2})
    let prev = BigInt(gen())
    for (let i = 0; i < 10_000; i++) {
      const cur = BigInt(gen())
      expect(cur).toBeGreaterThan(prev)
      prev = cur
    }
  })

  it('generates no collisions across a burst (sequence + overflow spin)', () => {
    const gen = snowflake({nodeId: 3})
    const seen = new Set<string>()
    for (let i = 0; i < 50_000; i++) seen.add(gen())
    expect(seen.size).toBe(50_000)
  })

  it('never collides between two columns sharing a node id', () => {
    // Two generators, same node → must draw from one shared sequence.
    const a = snowflake({nodeId: 4})
    const b = snowflake({nodeId: 4})
    const seen = new Set<string>()
    for (let i = 0; i < 20_000; i++) {
      seen.add(a())
      seen.add(b())
    }
    expect(seen.size).toBe(40_000)
  })

  it('embeds the node id and decodes round-trip', () => {
    const gen = snowflake({nodeId: 511})
    const before = Date.now()
    const id = gen()
    const after = Date.now()
    const d = decodeSnowflake(id)
    expect(d.nodeId).toBe(511)
    expect(d.sequence).toBeGreaterThanOrEqual(0)
    expect(d.date.getTime()).toBeGreaterThanOrEqual(before)
    expect(d.date.getTime()).toBeLessThanOrEqual(after)
    expect(d.timestamp).toBe(d.date.getTime() - DEFAULT_SNOWFLAKE_EPOCH)
  })

  it('reads nodeId from PYLON_NODE_ID when not passed', () => {
    process.env.PYLON_NODE_ID = '77'
    const gen = snowflake()
    expect(decodeSnowflake(gen()).nodeId).toBe(77)
  })

  it('rejects out-of-range node ids', () => {
    expect(() => snowflake({nodeId: 1024})).toThrow(/0\.\.1023/)
    expect(() => snowflake({nodeId: -1})).toThrow(/0\.\.1023/)
    expect(() => snowflake({nodeId: 1.5})).toThrow(/0\.\.1023/)
  })

  it('throws when a node id is reused with a mismatched epoch', () => {
    snowflake({nodeId: 900, epoch: 1_000})
    expect(() => snowflake({nodeId: 900, epoch: 2_000})).toThrow(/different epoch/)
    // Same epoch is fine (shares the allocator).
    expect(() => snowflake({nodeId: 900, epoch: 1_000})).not.toThrow()
  })

  it('honors a custom epoch on decode', () => {
    const epoch = 1_600_000_000_000
    const gen = snowflake({nodeId: 800, epoch})
    const d = decodeSnowflake(gen(), epoch)
    expect(Math.abs(d.date.getTime() - Date.now())).toBeLessThan(2_000)
  })
})

describe('process-configured node id (useDatabase seam)', () => {
  it('snowflakeDefault embeds the configured node id, read lazily', () => {
    setSnowflakeNodeId(300)
    expect(snowflakeNodeId()).toBe(300)
    expect(decodeSnowflake(snowflakeDefault()).nodeId).toBe(300)
    // Reconfiguring is picked up on the next id (lazy read).
    setSnowflakeNodeId(301)
    expect(decodeSnowflake(snowflakeDefault()).nodeId).toBe(301)
  })

  it('rejects an out-of-range configured node id', () => {
    expect(() => setSnowflakeNodeId(2048)).toThrow(/0\.\.1023/)
  })
})

describe('isSnowflakeString', () => {
  it('accepts a real snowflake, rejects junk', () => {
    expect(isSnowflakeString(snowflake({nodeId: 9})())).toBe(true)
    expect(isSnowflakeString('12345')).toBe(true)
    expect(isSnowflakeString('0')).toContain('range') // must be positive
    expect(isSnowflakeString('abc')).toContain('numeric')
    expect(isSnowflakeString('')).toContain('numeric')
    expect(isSnowflakeString(123 as unknown)).toContain('numeric')
    expect(isSnowflakeString('99999999999999999999')).toContain('range') // 20 digits, > 2^64
  })
})
