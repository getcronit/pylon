/**
 * Multi-tenancy (auto-scoping) + feature gating, against a real Postgres.
 * App `shop` is tenant-scoped on `orgId` and gated by feature 'shop'.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  Database,
  defineFeatures,
  FeatureDisabledError,
  gateResolvers,
  getModelDefinitionOrThrow,
  manager,
  models,
  requireFeature,
  runWithAppContext,
  setDefaultDatabase,
  syncSchema
} from '../../src/index'

const FEATURES = defineFeatures(['shop', 'billing'] as const)

const shop = models.app('shop', {tenant: 'orgId', feature: FEATURES.shop})

@shop.model() // → table "shop_widget", tenant-scoped on orgId
class Widget extends shop.Model {
  static objects = manager(Widget)
  id = shop.ID()
  orgId = shop.Text()
  name = shop.Text()
}

const def = getModelDefinitionOrThrow(Widget)
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('tenancy + features (registry, no DB)', () => {
  it('resolves the tenant column from the app option', () => {
    expect(def.tenantColumn).toBe('org_id')
  })

  it('defineFeatures gives a typed registry', () => {
    expect(FEATURES.shop).toBe('shop')
  })

  it('requireFeature throws FeatureDisabledError when the feature is absent', () => {
    runWithAppContext({features: ['billing']}, () => {
      expect(() => requireFeature(FEATURES.shop)).toThrow(FeatureDisabledError)
    })
    runWithAppContext({features: ['shop']}, () => {
      expect(() => requireFeature(FEATURES.shop)).not.toThrow()
    })
  })

  it('gate wraps resolvers to check the feature (same shape, identity-typed)', async () => {
    const gated = shop.gate({list: () => 'ok'})
    await runWithAppContext({features: []}, async () => {
      expect(() => gated.list()).toThrow(FeatureDisabledError)
    })
    await runWithAppContext({features: ['shop']}, async () => {
      expect(gated.list()).toBe('ok')
    })
  })
})

describe.skipIf(!runDb)('tenant auto-scoping (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('shop_widget').ifExists().cascade().execute()
    await syncSchema([def])
  })
  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('shop_widget').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  const asOrg = <T>(orgId: string, fn: () => Promise<T>) =>
    runWithAppContext({tenant: orgId}, fn)

  it('create auto-stamps the tenant; reads auto-filter by it', async () => {
    await asOrg('org-A', async () => {
      const w = await Widget.objects.create({name: 'a1'})
      expect(w.orgId).toBe('org-A') // auto-stamped from the ambient tenant
    })
    await asOrg('org-B', async () => {
      await Widget.objects.create({name: 'b1'})
    })

    // each org sees only its own rows
    await asOrg('org-A', async () => {
      const names = (await Widget.objects.all()).map(w => w.name)
      expect(names).toEqual(['a1'])
      expect(await Widget.objects.count()).toBe(1)
    })
    await asOrg('org-B', async () => {
      expect((await Widget.objects.all()).map(w => w.name)).toEqual(['b1'])
    })
  })

  it('.unscoped() sees across tenants', async () => {
    await asOrg('org-A', async () => {
      expect(await Widget.objects.count()).toBe(1)
      expect(await Widget.objects.unscoped().all()).toHaveLength(2)
    })
  })

  it('refuses a scoped query when no tenant is bound', async () => {
    await db.run(async () => {
      await expect(Widget.objects.all()).rejects.toThrow(/tenant-scoped but no tenant is bound/i)
    })
  })

  it('admin create with an explicit tenant is respected (unscoped path)', async () => {
    await db.run(async () => {
      const w = await Widget.objects.create({orgId: 'org-C', name: 'c1'})
      expect(w.orgId).toBe('org-C')
    })
    await asOrg('org-C', async () => {
      expect((await Widget.objects.all()).map(w => w.name)).toEqual(['c1'])
    })
  })
})
