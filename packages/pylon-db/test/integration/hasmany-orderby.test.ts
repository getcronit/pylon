import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  manager,
  setDefaultDatabase,
  syncSchema,
  text,
  timestamp,
  type Relation,
  type RelatedManager
} from '../../src/index'

// A parent with two hasMany relations to the SAME child table + FK, differing
// only in ordering — exercises asc/desc resolution AND the batch-token split
// (the two orderings must not collapse into one batched query). Forward refs
// (`() => Note`) are lazy, so the relations can be declared before Note exists.
class Thread extends Model {
  static objects = manager(Thread)
  id = id()
  title = text()
  notesAsc = hasMany(() => Note, {foreignKey: 'threadId', orderBy: 'createdAt'})
  notesDesc = hasMany(() => Note, {foreignKey: 'threadId', orderBy: '-createdAt'})
  declare notesAscRel: RelatedManager<Note>
}
class Note extends Model {
  static objects = manager(Note)
  id = id()
  body = text()
  threadId = foreignKey(() => Thread)
  createdAt = timestamp()
  declare thread: Relation<Thread>
}

new Pylon({db: {models: [Thread, Note]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('hasMany orderBy (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('note').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('thread').ifExists().cascade().execute()
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('note').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('thread').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('orders a hasMany list by the declared property (asc and desc)', async () => {
    const t = await Thread.objects.create({title: 'T'})
    // Insert out of chronological order so physical/DB order != createdAt order.
    await Note.objects.create({body: 'mid', threadId: t.id, createdAt: new Date('2026-06-29T09:46:24Z')})
    await Note.objects.create({body: 'late', threadId: t.id, createdAt: new Date('2026-06-29T09:46:26Z')})
    await Note.objects.create({body: 'early', threadId: t.id, createdAt: new Date('2026-06-29T08:34:49Z')})

    const fresh = await Thread.objects.get({id: t.id})
    const asc = await fresh.notesAsc
    const desc = await fresh.notesDesc

    expect(asc.map(n => n.body)).toEqual(['early', 'mid', 'late'])
    expect(desc.map(n => n.body)).toEqual(['late', 'mid', 'early'])
  })
})
