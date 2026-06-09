import {describe, expect, it} from 'vitest'
import {db, getModelDefinitionOrThrow, migrations, models} from '../src/index'

// Define a model entirely through the capitalized namespaced API.
@models.model()
class Widget extends models.Model {
  id = models.ID()
  name = models.Text({unique: true})
  price = models.Int({nullable: true})
}

describe('namespaced public API', () => {
  it('models.* exposes capitalized field types + Model', () => {
    expect(models.Model).toBeTypeOf('function')
    for (const k of ['ID', 'Text', 'Int', 'Boolean', 'Timestamp', 'ForeignKey', 'HasMany']) {
      expect(models[k as keyof typeof models], k).toBeTypeOf('function')
    }
  })

  it('a model defined via models.* registers correctly', () => {
    const def = getModelDefinitionOrThrow(Widget)
    expect(def.tableName).toBe('widget')
    expect(def.columns.map(c => c.propertyKey)).toEqual(
      expect.arrayContaining(['id', 'name', 'price'])
    )
    expect(def.primaryKey?.propertyKey).toBe('id')
  })

  it('db.* and migrations.* expose their members', () => {
    expect(db.connect).toBeTypeOf('function')
    expect(db.syncSchema).toBeTypeOf('function')
    expect(db.manager).toBeTypeOf('function')
    expect(migrations.MigrationRunner).toBeTypeOf('function')
    expect(migrations.planMigration).toBeTypeOf('function')
  })
})
