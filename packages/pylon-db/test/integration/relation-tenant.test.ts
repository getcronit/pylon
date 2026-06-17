/**
 * Tenant scoping on RELATION reads against a real Postgres. A relation read must be
 * scoped exactly like a direct query: walking a `belongsTo`/`hasMany` off an
 * instance you hold (even one from another tenant, loaded via `.unscoped()`) must
 * NOT surface another tenant's rows. Regression test for the leak where relation
 * loaders applied only the read policy (tenant-agnostic, e.g. `!!principal`) and so
 * let traversal cross the tenant boundary.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  manager,
  Model,
  model,
  type Relation,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'
import {runAsSystem, runWithAppContext} from '../../src/app-context'

@model({table: 'rt_org'}) // tenant ROOT — no tenant column, never tenant-scoped
class Org extends Model {
  static objects = manager(Org)
  id = id()
  name = text()
  docs = hasMany(() => Doc, {foreignKey: 'orgId'})
}

@model({table: 'rt_doc', tenant: 'orgId'}) // tenant-scoped on orgId
class Doc extends Model {
  static objects = manager(Doc)
  id = id()
  title = text()
  orgId = foreignKey(() => Org) // tenant column AND belongsTo Org
  declare org: Relation<Org>
  parentId = foreignKey(() => Doc, {nullable: true}) // self-ref, tenant-scoped target
  declare parent: Relation<Doc>
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('relation reads are tenant-scoped (Postgres)', () => {
  let db: Database
  const ids: Record<string, number> = {}
  const ctx = (tenant: number) => ({tenant, principal: {userId: tenant}})

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['rt_doc', 'rt_org']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()

    const orgA = await runWithAppContext({}, () => Org.objects.create({name: 'A'}))
    const orgB = await runWithAppContext({}, () => Org.objects.create({name: 'B'}))
    ids.orgA = orgA.id
    ids.orgB = orgB.id

    // create within a tenant → the tenant (orgId) is stamped from the bound context
    const docA = await runWithAppContext(ctx(orgA.id), () => Doc.objects.create({title: 'docA'}))
    const pB = await runWithAppContext(ctx(orgB.id), () => Doc.objects.create({title: 'pB'}))
    const docB = await runWithAppContext(ctx(orgB.id), () =>
      Doc.objects.create({title: 'docB', parentId: pB.id})
    )
    ids.docA = docA.id
    ids.pB = pB.id
    ids.docB = docB.id
  })

  afterAll(async () => {
    if (db) {
      for (const t of ['rt_doc', 'rt_org']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('hasMany: same tenant sees its rows', async () => {
    const own = await runWithAppContext(ctx(ids.orgA), async () =>
      (await Org.objects.get({id: ids.orgA})).docs
    )
    expect((await own).map((d: Doc) => d.title)).toEqual(['docA'])
  })

  it('hasMany: holding another tenant\'s parent does NOT leak its children', async () => {
    // bound to orgA, but holding orgB's (tenant-root) Org instance
    const cross = await runWithAppContext(ctx(ids.orgA), async () =>
      (await Org.objects.get({id: ids.orgB})).docs
    )
    expect((await cross).map((d: Doc) => d.title)).toEqual([]) // pre-fix: ['pB','docB']
  })

  it('belongsTo: same tenant resolves', async () => {
    const parent = await runWithAppContext(ctx(ids.orgB), async () => {
      const d = await Doc.objects.get({id: ids.docB})
      return (await d.parent)?.title
    })
    expect(parent).toBe('pB')
  })

  it('belongsTo: cross-tenant target is filtered to null', async () => {
    // load docB (orgB) past the tenant scope via .unscoped(), then traverse its
    // belongsTo while bound to orgA → the orgB parent must not be visible.
    const parent = await runWithAppContext(ctx(ids.orgA), async () => {
      const d = await Doc.objects.unscoped().get({id: ids.docB})
      return d.parent
    })
    expect(await parent).toBeNull() // pre-fix: the orgB parent row
  })

  it('a tenant-scoped relation read with NO tenant bound fails closed', async () => {
    await expect(
      runWithAppContext({}, async () => (await Org.objects.get({id: ids.orgA})).docs)
    ).rejects.toThrow(/no tenant is bound/)
  })

  it('runAsSystem bypasses tenant scoping on relation reads', async () => {
    const all = await runWithAppContext(ctx(ids.orgA), () =>
      runAsSystem(async () => (await Org.objects.get({id: ids.orgB})).docs)
    )
    expect((await all).map((d: Doc) => d.title).sort()).toEqual(['docB', 'pB'])
  })
})
