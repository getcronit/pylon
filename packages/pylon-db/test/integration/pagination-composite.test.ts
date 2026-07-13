/**
 * Composite-keyset pagination (.paginate({orderBy: [...]})), against a real Postgres.
 * The interesting cases: (1) a page boundary that falls ON the group switch — a
 * single-column keyset would skip/dupe there; (2) a nullable middle column.
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

class Node extends Model {
  static config = {table: 'page_node'} satisfies ModelConfig<Node>
  static objects = manager(Node)
  id = id()
  kind = text() // 'FOLDER' | 'FILE'
  name = text()
  size = int({nullable: true})
}
new Pylon({db: {models: [Node]}})

const def = getModelDefinitionOrThrow(Node)
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

// Drain a connection page-by-page (size 2) to prove no skips/dupes across boundaries.
async function drainForward(orderBy: string[]): Promise<string[]> {
  const names: string[] = []
  let after: string | undefined
  for (;;) {
    const p = await Node.objects.paginate({first: 2, orderBy, after})
    names.push(...p.nodes.map(n => n.name))
    if (!p.pageInfo.hasNextPage) break
    after = p.pageInfo.endCursor!
  }
  return names
}

describe.skipIf(!runDb)('composite-keyset pagination (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('page_node').ifExists().cascade().execute()
    await syncSchema([def])
    // 3 folders (size null) + 3 files (distinct sizes).
    await Node.objects.create({kind: 'FOLDER', name: 'alpha', size: null})
    await Node.objects.create({kind: 'FOLDER', name: 'bravo', size: null})
    await Node.objects.create({kind: 'FOLDER', name: 'charlie', size: null})
    await Node.objects.create({kind: 'FILE', name: 'delta', size: 30})
    await Node.objects.create({kind: 'FILE', name: 'echo', size: 10})
    await Node.objects.create({kind: 'FILE', name: 'foxtrot', size: 20})
  })
  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('page_node').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('groups folders-first, then sorts by name — no skip/dupe at the group boundary', async () => {
    // kind desc → FOLDER before FILE; name asc within each group.
    const one = await Node.objects.paginate({first: 10, orderBy: ['-kind', 'name']})
    expect(one.nodes.map(n => n.name)).toEqual([
      'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'
    ])
    expect(one.totalCount).toBe(6)
    // Same sequence when paged 2-at-a-time (the boundary charlie→delta crosses kind).
    expect(await drainForward(['-kind', 'name'])).toEqual([
      'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'
    ])
  })

  it('backward paging reconstructs the same order', async () => {
    const last = await Node.objects.paginate({last: 2, orderBy: ['-kind', 'name']})
    expect(last.nodes.map(n => n.name)).toEqual(['echo', 'foxtrot'])
    expect(last.pageInfo.hasPreviousPage).toBe(true)
    const prev = await Node.objects.paginate({
      last: 2,
      orderBy: ['-kind', 'name'],
      before: last.pageInfo.startCursor!
    })
    expect(prev.nodes.map(n => n.name)).toEqual(['charlie', 'delta'])
  })

  it('handles a NULLable secondary column (folders have null size)', async () => {
    // kind desc first (folders), then size asc (nulls last within a group — but the
    // folders are already separated by kind). Files: echo(10) foxtrot(20) delta(30).
    const drained = await drainForward(['-kind', 'size'])
    expect(drained.slice(0, 3).sort()).toEqual(['alpha', 'bravo', 'charlie']) // folders (any order)
    expect(drained.slice(3)).toEqual(['echo', 'foxtrot', 'delta']) // files by size asc
    expect(drained).toHaveLength(6) // no skips/dupes
  })

  const idOf = async (name: string) =>
    (await Node.objects.filter({name}).first())!.id

  it('anchor seeks into a composite order (startIndex = rank, window inclusive)', async () => {
    // Order: alpha,bravo,charlie,delta,echo,foxtrot. delta is index 3.
    const page = await Node.objects.paginate({
      first: 2,
      orderBy: ['-kind', 'name'],
      anchor: await idOf('delta')
    })
    expect(page.nodes.map(n => n.name)).toEqual(['delta', 'echo'])
    expect(page.startIndex).toBe(3)
    expect(page.pageInfo.hasPreviousPage).toBe(true)
  })

  it('anchor on a NULL-valued keyset column (folder, null size) ranks by the PK tiebreak', async () => {
    // ['-kind','size']: folders first (all null size → PK order), then files by size.
    // bravo is the 2nd folder → index 1.
    const page = await Node.objects.paginate({
      first: 2,
      orderBy: ['-kind', 'size'],
      anchor: await idOf('bravo')
    })
    expect(page.nodes.map(n => n.name)).toEqual(['bravo', 'charlie'])
    expect(page.startIndex).toBe(1)
  })
})
