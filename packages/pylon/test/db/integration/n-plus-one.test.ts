/**
 * N+1 advisory + batching, against a real Postgres. Each pair runs the SAME logical
 * access two ways: an UN-batched shape (asserts a `[pylon-db:n+1]` warning) and a
 * BATCHED shape (asserts NO warning + a small, constant query count). Covers standalone
 * `.first()` loops, keyed hasMany, `batchKey()` counts, and the batched M2M relation.
 */
import pg from 'pg'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  batchKey,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  manager,
  manyToMany,
  Model,
  type ModelConfig,
  runAsSystem,
  syncSchema,
  text
} from '@/db/index'

class Owner extends Model {
  static config = {table: 'nn_owner'} satisfies ModelConfig<Owner>
  static objects = manager(Owner)
  id = id()
  name = text()
  children = hasMany(() => Child, {foreignKey: 'ownerId'})
  tags = manyToMany(() => Tag)
}
new Pylon({db: {models: [Owner]}})

class Child extends Model {
  static config = {table: 'nn_child'} satisfies ModelConfig<Child>
  static objects = manager(Child)
  id = id()
  ownerId = foreignKey(() => Owner)
}
new Pylon({db: {models: [Child]}})

class Tag extends Model {
  static config = {table: 'nn_tag'} satisfies ModelConfig<Tag>
  static objects = manager(Tag)
  id = id()
  label = text()
}
new Pylon({db: {models: [Tag]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT
const N = 15 // > the default advisory threshold (12)

// Count executed SQL to prove batching is O(1) in the number of parents.
let queries = 0
const origQuery = (pg as any).Client.prototype.query
;(pg as any).Client.prototype.query = function (...a: any[]) {
  queries++
  return origQuery.apply(this, a)
}

const warned = (calls: any[][]) =>
  calls.map(c => String(c[0])).some(m => m.includes('[pylon-db:n+1]'))

describe.skipIf(!runDb)('n+1 advisory + batching (Postgres)', () => {
  let db: Database
  const owners: number[] = []
  const children: number[] = []

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['nn_owner_nn_tag', 'nn_child', 'nn_tag', 'nn_owner']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
    await runAsSystem(async () => {
      const tags = await Promise.all(
        Array.from({length: 3}, (_, i) => Tag.objects.create({label: `t${i}`}))
      )
      for (let i = 0; i < N; i++) {
        const o = await Owner.objects.create({name: `o${i}`})
        owners.push(o.id)
        for (let c = 0; c < 2; c++) {
          const ch = await Child.objects.create({ownerId: o.id})
          children.push(ch.id)
        }
        await o.tags.set(tags.map(t => t.id))
      }
    })
  })

  afterAll(async () => {
    for (const t of ['nn_owner_nn_tag', 'nn_child', 'nn_tag', 'nn_owner']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await db.destroy()
  })

  it('WARNS + names the batchKey column: .first() per id in a loop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runAsSystem(async () => {
      await Promise.all(children.map(cid => Child.objects.filter({id: cid}).first()))
    })
    const calls = warn.mock.calls
    warn.mockRestore()
    expect(warned(calls)).toBe(true)
    // Only `id` varies across the repeats → it's suggested as the batchKey() target.
    const msg = calls.map(c => String(c[0])).find(m => m.includes('[pylon-db:n+1]'))!
    expect(msg).toMatch(/batchKey\(\).*`id`/)
  })

  it('NO warn: hasMany .all() across owners (keyed-batched)', async () => {
    const {lists, q, calls} = await runAsSystem(async () => {
      const os = await Owner.objects.all()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      queries = 0
      const lists = await Promise.all(os.map(o => o.children.all()))
      const out = {lists, q: queries, calls: warn.mock.calls.slice()}
      warn.mockRestore()
      return out
    })
    expect(lists.every(l => l.length === 2)).toBe(true)
    expect(warned(calls)).toBe(false)
    expect(q).toBeLessThan(N) // O(1)-ish, not one per owner
  })

  it('NO warn: batchKey() counts across owners (keyed-batched)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runAsSystem(() =>
      Promise.all(
        owners.map(oid => Child.objects.filter({ownerId: batchKey(oid)}).count())
      )
    )
    const calls = warn.mock.calls
    warn.mockRestore()
    expect(warned(calls)).toBe(false)
  })

  it('NO warn: M2M .all() across owners (now batched)', async () => {
    const {lists, q, calls} = await runAsSystem(async () => {
      const os = await Owner.objects.all()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      queries = 0
      const lists = await Promise.all(os.map(o => o.tags.all()))
      const out = {lists, q: queries, calls: warn.mock.calls.slice()}
      warn.mockRestore()
      return out
    })
    expect(lists.every(l => l.length === 3)).toBe(true)
    expect(warned(calls)).toBe(false)
    expect(q).toBeLessThan(N) // one join query for all owners, not N
  })

  it('NO warn: M2M .count() across owners (now batched)', async () => {
    const {counts, q, calls} = await runAsSystem(async () => {
      const os = await Owner.objects.all()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      queries = 0
      const counts = await Promise.all(os.map(o => o.tags.count()))
      const out = {counts, q: queries, calls: warn.mock.calls.slice()}
      warn.mockRestore()
      return out
    })
    expect(counts.every(c => c === 3)).toBe(true)
    expect(warned(calls)).toBe(false)
    expect(q).toBeLessThan(N)
  })
})
