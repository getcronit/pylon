/**
 * Relay-style cursor pagination (.paginate), against a real Postgres.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  getModelDefinitionOrThrow,
  id,
  int,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'

class Widget extends Model {
  static config = {table: 'page_widget'} satisfies ModelConfig<Widget>
  static objects = manager(Widget)
  id = id()
  name = text()
  rank = int()
}
new Pylon({db: {models: [Widget]}})

const def = getModelDefinitionOrThrow(Widget)
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('cursor pagination (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('page_widget').ifExists().cascade().execute()
    await syncSchema([def])
    for (let i = 1; i <= 5; i++) await Widget.objects.create({name: `w${i}`, rank: 10 - i})
  })
  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('page_widget').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('forward-paginates by PK with hasNextPage + cursors + totalCount', async () => {
    const p1 = await Widget.objects.paginate({first: 2})
    expect(p1.nodes.map(w => w.name)).toEqual(['w1', 'w2'])
    expect(p1.totalCount).toBe(5)
    expect(p1.pageInfo.hasNextPage).toBe(true)
    expect(p1.pageInfo.hasPreviousPage).toBe(false)
    expect(p1.pageInfo.endCursor).toBeTypeOf('string')

    const p2 = await Widget.objects.paginate({first: 2, after: p1.pageInfo.endCursor!})
    expect(p2.nodes.map(w => w.name)).toEqual(['w3', 'w4'])
    expect(p2.pageInfo.hasNextPage).toBe(true)
    expect(p2.pageInfo.hasPreviousPage).toBe(true)

    const p3 = await Widget.objects.paginate({first: 2, after: p2.pageInfo.endCursor!})
    expect(p3.nodes.map(w => w.name)).toEqual(['w5'])
    expect(p3.pageInfo.hasNextPage).toBe(false) // last page
  })

  it('orders by a custom field (and descending)', async () => {
    // rank: w1=9, w2=8, ... w5=5 → desc rank = w1..w5; asc rank = w5..w1
    const asc = await Widget.objects.paginate({first: 3, orderBy: 'rank'})
    expect(asc.nodes.map(w => w.name)).toEqual(['w5', 'w4', 'w3'])
    const desc = await Widget.objects.paginate({first: 3, orderBy: '-rank'})
    expect(desc.nodes.map(w => w.name)).toEqual(['w1', 'w2', 'w3'])
  })

  it('respects an existing filter', async () => {
    const page = await Widget.objects.filter({name: 'w3'}).paginate({first: 10})
    expect(page.nodes.map(w => w.name)).toEqual(['w3'])
    expect(page.totalCount).toBe(1)
    expect(page.pageInfo.hasNextPage).toBe(false)
  })

  it('exposes relay edges (cursor + node) aligned with nodes', async () => {
    const p = await Widget.objects.paginate({first: 2})
    expect(p.edges).toHaveLength(2)
    expect(p.edges.map(e => e.node.name)).toEqual(['w1', 'w2'])
    expect(p.edges[0].cursor).toBe(p.pageInfo.startCursor)
    expect(p.edges[1].cursor).toBe(p.pageInfo.endCursor)
  })

  it('backward-paginates with last/before (relay)', async () => {
    // last:2 → the final two in natural (PK) order
    const tail = await Widget.objects.paginate({last: 2})
    expect(tail.nodes.map(w => w.name)).toEqual(['w4', 'w5'])
    expect(tail.pageInfo.hasPreviousPage).toBe(true)
    expect(tail.pageInfo.hasNextPage).toBe(false)

    // before the tail's first cursor → the two preceding it
    const prev = await Widget.objects.paginate({
      last: 2,
      before: tail.pageInfo.startCursor!
    })
    expect(prev.nodes.map(w => w.name)).toEqual(['w2', 'w3'])
    expect(prev.pageInfo.hasNextPage).toBe(true) // there's a page after (before was set)
  })

  it('supports the skip (offset) fallback in forward mode', async () => {
    const page = await Widget.objects.paginate({first: 2, skip: 1})
    expect(page.nodes.map(w => w.name)).toEqual(['w2', 'w3'])
    expect(page.pageInfo.hasPreviousPage).toBe(true) // skip > 0
    expect(page.pageInfo.hasNextPage).toBe(true)
  })

  it('reports startIndex (0 on a plain first page, shifts with skip)', async () => {
    const first = await Widget.objects.paginate({first: 2})
    expect(first.startIndex).toBe(0)
    const skipped = await Widget.objects.paginate({first: 2, skip: 1})
    expect(skipped.startIndex).toBe(1)
  })

  const idOf = async (name: string) =>
    (await Widget.objects.filter({name}).first())!.id

  it('anchor seeks to a deep node (PK order): window starts AT it, startIndex = its rank', async () => {
    const page = await Widget.objects.paginate({first: 2, anchor: await idOf('w3')})
    expect(page.nodes.map(w => w.name)).toEqual(['w3', 'w4']) // inclusive of the anchor
    expect(page.startIndex).toBe(2) // w1,w2 precede it
    expect(page.pageInfo.hasPreviousPage).toBe(true) // rows before it
    expect(page.pageInfo.hasNextPage).toBe(true) // w5 after this window
  })

  it('anchor honours a custom order (asc rank → w5,w4,w3,…)', async () => {
    const page = await Widget.objects.paginate({
      first: 2,
      orderBy: 'rank',
      anchor: await idOf('w3')
    })
    expect(page.nodes.map(w => w.name)).toEqual(['w3', 'w2']) // asc rank from w3
    expect(page.startIndex).toBe(2) // w5, w4 precede w3 in asc-rank order
  })

  it('anchor on the first node → startIndex 0, no previous page', async () => {
    const page = await Widget.objects.paginate({first: 2, anchor: await idOf('w1')})
    expect(page.nodes.map(w => w.name)).toEqual(['w1', 'w2'])
    expect(page.startIndex).toBe(0)
    expect(page.pageInfo.hasPreviousPage).toBe(false)
  })

  it('anchor outside the filtered set → falls back to a plain first page', async () => {
    const page = await Widget.objects
      .filter({name: 'w2'})
      .paginate({first: 5, anchor: await idOf('w4')})
    expect(page.nodes.map(w => w.name)).toEqual(['w2'])
    expect(page.startIndex).toBe(0)
  })

  it('an explicit cursor/offset wins over anchor (loadNext/jumpTo pass through)', async () => {
    const anchor = await idOf('w3')
    const withSkip = await Widget.objects.paginate({first: 2, skip: 1, anchor})
    expect(withSkip.nodes.map(w => w.name)).toEqual(['w2', 'w3']) // skip wins, seek ignored
    expect(withSkip.startIndex).toBe(1)
  })
})
