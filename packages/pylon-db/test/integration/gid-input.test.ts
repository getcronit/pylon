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
  enumOf,
  foreignKey,
  id,
  manager,
  manyToMany,
  Model,
  setDefaultDatabase,
  syncSchema,
  text,
  toGid,
  type Relation
} from '../../src/index'
import {joinTableName} from '@getcronit/pylon-ir'

class GiAuthor extends Model {
  static config = {table: 'gi_author'} satisfies ModelConfig<GiAuthor>
  static objects = manager(GiAuthor)
  id = id({snowflake: true})
  name = text()
}
new Pylon({db: {models: [GiAuthor]}})

class GiTag extends Model {
  static config = {table: 'gi_tag'} satisfies ModelConfig<GiTag>
  static objects = manager(GiTag)
  id = id({snowflake: true})
  label = text()
  books = manyToMany(() => GiBook)
}
new Pylon({db: {models: [GiTag]}})

class GiBook extends Model {
  static config = {table: 'gi_book'} satisfies ModelConfig<GiBook>
  static objects = manager(GiBook)
  id = id({snowflake: true})
  title = text()
  authorId = foreignKey(() => GiAuthor)
  declare author: Relation<GiAuthor>
  tags = manyToMany(() => GiTag)
}
new Pylon({db: {models: [GiBook]}})

// STI: GiParty (base) + GiPerson (subclass, shared table) + GiInvoice (FK → base).
enum GiKind {
  PERSON = 'PERSON',
  ORG = 'ORG'
}
class GiParty extends Model {
  static config = {
    table: 'gi_party',
    inheritance: {strategy: 'single-table', discriminator: 'kind'}
  } satisfies ModelConfig<GiParty>
  static objects = manager(GiParty)
  id = id({snowflake: true})
  kind = enumOf(GiKind)
  name = text()
}
new Pylon({db: {models: [GiParty]}})

class GiPerson extends GiParty {
  static config = {discriminatorValue: GiKind.PERSON} satisfies ModelConfig<GiPerson>
  static objects = manager(GiPerson)
}
new Pylon({db: {models: [GiPerson]}})

class GiInvoice extends Model {
  static config = {table: 'gi_invoice'} satisfies ModelConfig<GiInvoice>
  static objects = manager(GiInvoice)
  id = id({snowflake: true})
  partyId = foreignKey(() => GiParty)
  declare party: Relation<GiParty>
}
new Pylon({db: {models: [GiInvoice]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('gid-on-input (Postgres)', () => {
  let db: Database
  let authorId: string
  let bookId: string

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of [joinTableName('gi_book', 'gi_tag'), 'gi_invoice', 'gi_book', 'gi_tag', 'gi_author', 'gi_party']) {
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
      for (const t of [joinTableName('gi_book', 'gi_tag'), 'gi_invoice', 'gi_book', 'gi_tag', 'gi_author', 'gi_party']) {
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

  it('accepts a subclass gid where the STI base is expected (FK + filter)', async () => {
    const person = await GiPerson.objects.create({name: 'Ada'})
    // FK to the base GiParty accepts a GiPerson (subclass) gid — same table/id family.
    const inv = await GiInvoice.objects.create({
      partyId: toGid('GiPerson', person.id) as never
    })
    expect(inv.partyId).toBe(person.id)
    // Base filter accepts the subclass gid too.
    const found = await GiParty.objects.get({id: toGid('GiPerson', person.id)})
    expect(found.id).toBe(person.id)
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

  it('decodes a gid on a MANY-TO-MANY link (join-row FK) so add() resolves', async () => {
    const tag = await GiTag.objects.create({label: 'fiction'})
    const book = await GiBook.objects.get({id: bookId})
    // The API hands out gids, so a client links by the tag's gid, not its raw id.
    await book.tags.add(toGid('GiTag', tag.id))
    // The join row stored the RAW local id (else the join FK would violate).
    const linked = await book.tags.all()
    expect(linked.map(t => t.id)).toEqual([tag.id])
    // remove() decodes the gid too.
    await book.tags.remove(toGid('GiTag', tag.id))
    expect((await book.tags.all()).length).toBe(0)
  })

  it('rejects a wrong-type gid on a many-to-many link', async () => {
    const book = await GiBook.objects.get({id: bookId})
    await expect(book.tags.add(toGid('GiAuthor', authorId))).rejects.toThrow(
      /Expected a GiTag id but received a GiAuthor id/
    )
  })
})
