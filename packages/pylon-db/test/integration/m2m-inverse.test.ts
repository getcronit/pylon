/**
 * Cross-app many-to-many via `{inverse: true}`: the canonical side owns +
 * synthesizes the join table; the inverse side (in another app) is a read/write
 * accessor over the SAME table and does NOT synthesize a second one. `appGroups`
 * infers the cross-app dependency (the join FKs into the other app's table).
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {joinTableName} from '@getcronit/pylon-ir'
import {connect, Database, db, models, setDefaultDatabase, syncSchema} from '../../src/index'
import {appGroups} from '../../src/migration-groups'

const docs = models.app('midocs')
const tagging = models.app('mitags')

@docs.model({table: 'mi_doc'})
class MDoc extends docs.Model {
  static objects = db.manager(MDoc)
  id = docs.ID()
  title = docs.Text()
  tags = docs.ManyToMany(() => MTag) // canonical owner — synthesizes the join
}

@tagging.model({table: 'mi_tag'})
class MTag extends tagging.Model {
  static objects = db.manager(MTag)
  id = tagging.ID()
  label = tagging.Text()
  documents = tagging.ManyToMany(() => MDoc, {inverse: true}) // accessor only
}

const JOIN = joinTableName('mi_doc', 'mi_tag')
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('inverse m2m — migration groups (unit)', () => {
  it('does not conflict, and the owner app depends on the target app', () => {
    const groups = appGroups()
    const owner = groups.find(g => g.name === 'midocs')!
    expect(owner.dependencies).toContain('mitags') // join FKs into mitags' table
  })
})

describe.skipIf(!runDb)('inverse m2m — runtime (Postgres)', () => {
  let database: Database
  beforeAll(async () => {
    database = connect({connectionString})
    for (const t of [JOIN, 'mi_doc', 'mi_tag']) {
      await database.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema() // ONE join table (inverse side skipped → no double-create)
  })
  afterAll(async () => {
    if (database) {
      for (const t of [JOIN, 'mi_doc', 'mi_tag']) {
        await database.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await database.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('synthesizes exactly one join table', async () => {
    const tables = (await database.kysely.introspection.getTables()).map(t => t.name)
    expect(tables.filter(n => n === JOIN).length).toBe(1)
  })

  it('reads and writes from BOTH the owning and inverse side', async () => {
    const d = await MDoc.objects.create({title: 'd'})
    const t = await MTag.objects.create({label: 't'})
    await d.tags.add(t) // write from the owning side
    expect((await d.tags.all()).map(x => x.label)).toEqual(['t'])
    expect((await t.documents.all()).map(x => x.title)).toEqual(['d']) // inverse reads through it

    const d2 = await MDoc.objects.create({title: 'd2'})
    await t.documents.add(d2) // write from the INVERSE side
    expect((await t.documents.all()).map(x => x.title).sort()).toEqual(['d', 'd2'])
  })
})
