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

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('model signals (Postgres)', () => {
  let db: Database
  const disconnects: Array<() => void> = []
  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['sig_widget', 'sig_audit']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema([getModelDefinitionOrThrow(Widget), getModelDefinitionOrThrow(Audit)])
  })
  afterEach(() => {
    while (disconnects.length) disconnects.pop()!()
  })
  afterAll(async () => {
    if (db) {
      for (const t of ['sig_widget', 'sig_audit']) {
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

  it('createMany({signals:false}) skips lifecycle hooks', async () => {
    let fired = 0
    disconnects.push(signals.postSave.connect(Widget, () => { fired++ }))
    await Widget.objects.createMany([{name: 'q1'}, {name: 'q2'}], {signals: false})
    expect(fired).toBe(0)
  })
})
