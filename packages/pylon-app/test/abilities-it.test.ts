/**
 * Integration proof (real Postgres): `defineAbilities` auto-wires the ORM. The
 * SAME rule set that powers `can()`/`filter()` registers row policies, so
 * `Model.objects` reads are ability-scoped and writes are ability-authorized —
 * the killer property of the resource tier — with no per-model policy by hand.
 *
 * Gated on PYLON_ORM_IT/DATABASE_URL like the pylon-db integration suite; uses
 * the same dev Postgres (5433).
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  type Database,
  db,
  defineAbilities,
  ForbiddenError,
  models,
  runWithAppContext,
  setDefaultDatabase,
  syncSchema
} from '../src/index'

const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'

const ability = models.app('abilityit')

@ability.model() // → abilityit_doc
class Doc extends ability.Model {
  static objects = db.manager(Doc)
  id = ability.ID()
  ownerId = ability.Int()
  shared = ability.Boolean({default: false})
  title = ability.Text()
}

// One rule set → both the in-resolver checks AND the ORM row policies.
defineAbilities((p: any, can) => {
  const uid = p?.id ?? -1
  if (p?.roles?.includes('admin')) {
    can('manage', 'all')
    return
  }
  can('read', Doc, {OR: [{ownerId: uid}, {shared: true}]}) // unconditional ref → probe governs Doc
  can('update', Doc, {ownerId: uid})
  if (p) can('create', Doc) // create only for an authenticated principal
})

const as = <T>(principal: any, fn: () => T): T =>
  runWithAppContext({principal, features: []}, fn)

describe.skipIf(!runDb)('abilities → ORM auto-scoping (Postgres)', () => {
  let database: Database

  beforeAll(async () => {
    database = connect({connectionString})
    setDefaultDatabase(database)
    await database.kysely.schema.dropTable('abilityit_doc').ifExists().cascade().execute()
    await syncSchema()
    // Seed across two owners + a shared doc.
    await as({id: 1}, () => Doc.objects.create({ownerId: 1, title: 'a1'}))
    await as({id: 1}, () => Doc.objects.create({ownerId: 1, shared: true, title: 'a2'}))
    await as({id: 2}, () => Doc.objects.create({ownerId: 2, title: 'b1'}))
  })

  afterAll(async () => {
    if (database) {
      await database.kysely.schema.dropTable('abilityit_doc').ifExists().cascade().execute()
      await database.destroy()
    }
    setDefaultDatabase(undefined)
  })

  const titles = (ds: Doc[]) => ds.map(d => d.title).sort()

  it('READ is ability-scoped: own + shared; admin sees all', async () => {
    expect(titles(await as({id: 1}, () => Doc.objects.all()))).toEqual(['a1', 'a2'])
    expect(titles(await as({id: 2}, () => Doc.objects.all()))).toEqual(['a2', 'b1'])
    expect(titles(await as({id: 9, roles: ['admin']}, () => Doc.objects.all()))).toEqual([
      'a1',
      'a2',
      'b1'
    ])
  })

  it('CREATE is gated to authenticated principals', async () => {
    await expect(
      as(undefined, () => Doc.objects.create({ownerId: 5, title: 'x'}))
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('UPDATE a readable-but-unowned row → ForbiddenError', async () => {
    // user 2 can READ a2 (shared) but not UPDATE it (owned by user 1).
    await expect(
      as({id: 2}, async () => {
        const a2 = await Doc.objects.get({title: 'a2'})
        a2.title = 'hax'
        await a2.$save()
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('UPDATE an owned row succeeds', async () => {
    await as({id: 1}, async () => {
      const a1 = await Doc.objects.get({title: 'a1'})
      a1.title = 'a1-edited'
      await a1.$save()
    })
    expect(titles(await as({id: 1}, () => Doc.objects.all()))).toEqual(['a1-edited', 'a2'])
  })
})
