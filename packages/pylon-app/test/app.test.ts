import {describe, expect, it} from 'vitest'
import {defineApp, getModelDefinition, manager} from '../src/index'

const shop = defineApp('apptest_shop', {tenant: 'orgId', feature: 'shop'})

@shop.model({table: 'apptest_widget'})
class Widget extends shop.Model {
  static objects = manager(Widget)
  id = shop.ID()
  orgId = shop.Int()
  name = shop.Text()
}

// Immutable builder: chain resolvers + routes; the result carries the merged type.
const app = shop
  .resolvers({
    Query: {widgets: (): Promise<Widget[]> => Widget.objects.all()},
    Mutation: {addWidget: (name: string): Promise<Widget> => Widget.objects.create({name})}
  })
  .routes(r => {
    void r // wired to Hono in the next increment
  })

describe('defineApp', () => {
  it('registers its model under the app (migration group + tenant)', () => {
    const def = getModelDefinition(Widget)
    expect(def?.app).toBe('apptest_shop')
    expect(def?.tableName).toBe('apptest_widget')
    expect(def?.tenantColumn).toBe('org_id') // tenant prop resolved to column
  })

  it('owns + accumulates resolvers and routes; carries config', () => {
    expect(Object.keys(app.__resolvers.Query ?? {})).toContain('widgets')
    expect(Object.keys(app.__resolvers.Mutation ?? {})).toContain('addWidget')
    expect(app.__routes.length).toBe(1)
    expect(app.name).toBe('apptest_shop')
    expect(app.config.feature).toBe('shop')
  })

  it('model builders survive the builder chain', () => {
    expect(typeof app.ID).toBe('function')
    expect(typeof app.model).toBe('function')
  })
})
