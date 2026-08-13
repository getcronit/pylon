/**
 * Model signals (Django-style) — pre/post save + delete, per-model + global,
 * `created` flag, and an audit-row receiver writing inside the same transaction.
 */
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  getModelDefinitionOrThrow,
  id,
  manager,
  Model,
  setDefaultDatabase,
  signals,
  syncSchema,
  text,
  type SaveSignalPayload
} from '../../src/index'

class Widget extends Model {
  static config = {table: 'sig_widget'} satisfies ModelConfig<Widget>
  static objects = manager(Widget)
  id = id()
  name = text()
}
new Pylon({db: {models: [Widget]}})

class Audit extends Model {
  static config = {table: 'sig_audit'} satisfies ModelConfig<Audit>
  static objects = manager(Audit)
  id = id()
  action = text()
  target = text()
}
new Pylon({db: {models: [Audit]}})

// A model with a generated `tsvector` (fts) column + a hidden `$secret` column — to prove the
// `changes` diff excludes both (they aren't user-authored public fields).
class Doc extends Model {
  static config = {table: 'sig_doc', search: {columns: ['title']}} satisfies ModelConfig<Doc>
  static objects = manager(Doc)
  id = id()
  title = text()
  $secret = text({nullable: true})
}
new Pylon({db: {models: [Doc]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('model signals (Postgres)', () => {
  let db: Database
  const disconnects: Array<() => void> = []
  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['sig_widget', 'sig_audit', 'sig_doc']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema([
      getModelDefinitionOrThrow(Widget),
      getModelDefinitionOrThrow(Audit),
      getModelDefinitionOrThrow(Doc)
    ])
  })
  afterEach(() => {
    while (disconnects.length) disconnects.pop()!()
  })
  afterAll(async () => {
    if (db) {
      for (const t of ['sig_widget', 'sig_audit', 'sig_doc']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('fires postSave with created=true on insert, false on update (per-model + typed)', async () => {
    const {saveInstance} = await import('../../src/manager')
    const seen: Array<{name: string; created: boolean}> = []
    disconnects.push(
      signals.postSave.connect(Widget, ({instances, created}) => {
        for (const w of instances) seen.push({name: w.name, created}) // instances typed Widget[]
      })
    )
    const w = await Widget.objects.create({name: 'a'}) // insert → created:true
    w.name = 'a2'
    await saveInstance(w as object) // update → created:false
    expect(seen).toEqual([
      {name: 'a', created: true},
      {name: 'a2', created: false}
    ])
  })

  it('a global receiver sees every model', async () => {
    const models: string[] = []
    disconnects.push(
      signals.postSave.connect(({model}: SaveSignalPayload) => {
        models.push((model as any).name)
      })
    )
    await Widget.objects.create({name: 'b'})
    expect(models).toContain('Widget')
  })

  it('preDelete/postDelete fire around a delete', async () => {
    const order: string[] = []
    disconnects.push(signals.preDelete.connect(Widget, () => order.push('pre')))
    disconnects.push(signals.postDelete.connect(Widget, () => order.push('post')))
    const w = await Widget.objects.create({name: 'c'})
    const {deleteInstance} = await import('../../src/manager')
    await deleteInstance(w as object)
    expect(order).toEqual(['pre', 'post'])
  })

  it('an audit receiver writes inside the same transaction (rolls back with it)', async () => {
    disconnects.push(
      signals.postSave.connect(Widget, async ({instances, created}) => {
        await Audit.objects.createMany(
          instances.map(w => ({action: created ? 'create' : 'update', target: w.name}))
        )
      })
    )
    // commit path: audit row is written
    await db.run(async () => {
      await Widget.objects.create({name: 'd'})
    })
    expect((await Audit.objects.filter({target: 'd'}).all()).length).toBe(1)

    // rollback path: the widget + its audit row both vanish
    await db.kysely
      .transaction()
      .execute(async trx => {
        const {databaseForKysely} = await import('../../src/database')
        await databaseForKysely(trx).run(async () => {
          await Widget.objects.create({name: 'e'})
          throw new Error('boom') // roll back
        })
      })
      .catch(() => {})
    expect((await Audit.objects.filter({target: 'e'}).all()).length).toBe(0)
  })

  it('createMany inserts in one round-trip and fires postSave once with the array', async () => {
    const batches: number[] = []
    disconnects.push(
      signals.postSave.connect(Widget, ({instances, created}) => {
        if (created) batches.push(instances.length)
      })
    )
    const made = await Widget.objects.createMany([{name: 'm1'}, {name: 'm2'}, {name: 'm3'}])
    expect(made).toHaveLength(3)
    expect(made.every(w => typeof w.id === 'number')).toBe(true) // generated PKs assigned
    expect(batches).toEqual([3]) // ONE postSave carrying all three (not 3 separate)
    expect((await Widget.objects.filter({}).count()) >= 3).toBe(true)
  })

  it('afterCommit receiver fires only after the transaction commits, outside it', async () => {
    const order: string[] = []
    disconnects.push(signals.postSave.connect(Widget, () => order.push('inline')))
    disconnects.push(
      signals.postSave.connect(Widget, () => order.push('commit'), {afterCommit: true})
    )
    const {transaction} = await import('../../src/database')
    await transaction(async () => {
      await Widget.objects.create({name: 'ac1'})
      order.push('mid') // still inside the txn, before COMMIT
    })
    // inline fired during the write; 'mid' before commit; the afterCommit hook last.
    expect(order).toEqual(['inline', 'mid', 'commit'])
  })

  it('afterCommit receiver does NOT fire on rollback', async () => {
    let fired = 0
    disconnects.push(
      signals.postSave.connect(Widget, () => { fired++ }, {afterCommit: true})
    )
    const {transaction} = await import('../../src/database')
    await transaction(async () => {
      await Widget.objects.create({name: 'ac2'})
      throw new Error('boom') // roll back
    }).catch(() => {})
    expect(fired).toBe(0)
    expect((await Widget.objects.filter({name: 'ac2'}).all()).length).toBe(0)
  })

  it('afterCommit runs after an autocommit write when no transaction is open', async () => {
    const seen: string[] = []
    disconnects.push(
      signals.postSave.connect(
        Widget,
        ({instances}) => {
          for (const w of instances) seen.push(w.name)
        },
        {afterCommit: true}
      )
    )
    await Widget.objects.createMany([{name: 'ac3'}]) // single autocommit stmt, no txn
    await Promise.resolve() // let the deferred microtask settle
    await new Promise(r => setTimeout(r, 0))
    expect(seen).toContain('ac3')
  })

  it('afterCommit receivers registered across nested saves all fire after the OUTER commit', async () => {
    const order: string[] = []
    disconnects.push(
      signals.postSave.connect(Widget, ({instances}) =>
        order.push(`commit:${instances[0].name}`), {afterCommit: true})
    )
    const {transaction} = await import('../../src/database')
    await transaction(async () => {
      await Widget.objects.create({name: 'outer'}) // saveInstance JOINS this txn
      await Widget.objects.create({name: 'inner'})
      order.push('body-end')
    })
    // both pokes deferred past the single outer commit, in registration order
    expect(order).toEqual(['body-end', 'commit:outer', 'commit:inner'])
  })

  it('postSave `changes` excludes generated (fts) and hidden columns', async () => {
    const {saveInstance} = await import('../../src/manager')
    let seen: Record<string, {from: unknown; to: unknown}> | undefined
    disconnects.push(
      signals.postSave.connect(Doc, ({changes, created}) => {
        if (!created) seen = changes
      })
    )
    const d = await Doc.objects.create({title: 'hello', $secret: 's1'})
    d.title = 'hello world' // authored change — also recomputes the fts tsvector under the hood
    d.$secret = 's2' // hidden change — must NOT surface (raw values could be sensitive)
    await saveInstance(d as object)
    // Only the authored, public column is in the changeset — no `fts`, no `secret`.
    expect(Object.keys(seen ?? {})).toEqual(['title'])
    expect(seen?.title).toEqual({from: 'hello', to: 'hello world'})
  })

  it('createMany({signals:false}) skips lifecycle hooks', async () => {
    let fired = 0
    disconnects.push(signals.postSave.connect(Widget, () => { fired++ }))
    await Widget.objects.createMany([{name: 'q1'}, {name: 'q2'}], {signals: false})
    expect(fired).toBe(0)
  })
})
