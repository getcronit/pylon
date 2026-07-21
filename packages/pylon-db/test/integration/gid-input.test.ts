/**
 * gid-on-input (slice 2): the ORM where-builder decodes the gids the API emits
 * back to raw local ids for PK and FK filters, type-checked — so `.get`/`.filter`
 * accept a gid OR a raw id interchangeably. Needs a live Postgres.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  foreignKey,
  id,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text,
  toGid,
  type Relation
} from '../../src/index'

class GiAuthor extends Model {
  static config = {table: 'gi_author'} satisfies ModelConfig<GiAuthor>
  static objects = manager(GiAuthor)
  id = id({snowflake: true})
  name = text()
}
new Pylon({db: {models: [GiAuthor]}})

class GiBook extends Model {
  static config = {table: 'gi_book'} satisfies ModelConfig<GiBook>
  static objects = manager(GiBook)
  id = id({snowflake: true})
  title = text()
  authorId = foreignKey(() => GiAuthor)
  declare author: Relation<GiAuthor>
}
new Pylon({db: {models: [GiBook]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('gid-on-input (Postgres)', () => {
  let db: Database
  let authorId: string
  let bookId: string

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['gi_book', 'gi_author']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
    const a = await GiAuthor.objects.create({name: 'Ada'})
    authorId = a.id
    const b = await GiBook.objects.create({title: 'Notes', authorId: a.id})
    bookId = b.id
  })
  afterAll(async () => {
    if (db) {
      for (const t of ['gi_book', 'gi_author']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('get() accepts a raw id (unchanged)', async () => {
    const b = await GiBook.objects.get({id: bookId})
    expect(b.title).toBe('Notes')
  })

  it('get() accepts the gid the API emits (decoded to the raw id)', async () => {
    const b = await GiBook.objects.get({id: toGid('GiBook', bookId)})
    expect(b.id).toBe(bookId)
    expect(b.title).toBe('Notes')
  })

  it('filter { in: [gid] } decodes each element', async () => {
    const rows = await GiBook.objects.filter({id: {in: [toGid('GiBook', bookId)]}}).all()
    expect(rows.map(r => r.id)).toEqual([bookId])
  })

  it('decodes a gid on a FOREIGN KEY filter against the target type', async () => {
    const rows = await GiBook.objects.filter({authorId: toGid('GiAuthor', authorId)}).all()
    expect(rows.map(r => r.id)).toEqual([bookId])
  })

  it('decodes a gid FK on CREATE (write path) so the FK resolves', async () => {
    // A separate author so the FK-filter tests above keep their exact counts.
    const bob = await GiAuthor.objects.create({name: 'Bob'})
    // The API hands out gids, so a client passes an author gid straight into create.
    const b = await GiBook.objects.create({
      title: 'Written',
      authorId: toGid('GiAuthor', bob.id) as never
    })
    // Stored as the RAW local id (else the FK would violate), and re-readable.
    expect(b.authorId).toBe(bob.id)
    const reloaded = await GiBook.objects.get({id: b.id})
    expect(reloaded.authorId).toBe(bob.id)
  })

  it('rejects a wrong-type gid FK on create', async () => {
    await expect(
      GiBook.objects.create({title: 'x', authorId: toGid('GiBook', authorId) as never})
    ).rejects.toThrow(/Expected a GiAuthor id but received a GiBook id/)
  })

  it('rejects a wrong-type gid with BAD_REQUEST', async () => {
    // A GiAuthor gid where a GiBook id is expected → type guard fires.
    await expect(GiBook.objects.get({id: toGid('GiAuthor', bookId)})).rejects.toThrow(
      /Expected a GiBook id but received a GiAuthor id/
    )
  })

  it('a raw id that is not a gid still passes through on an FK filter', async () => {
    const rows = await GiBook.objects.filter({authorId}).all()
    expect(rows.map(r => r.id)).toEqual([bookId])
  })
})
