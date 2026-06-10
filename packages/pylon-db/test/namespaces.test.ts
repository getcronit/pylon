import {describe, expect, it} from 'vitest'
import {db, getModelDefinitionOrThrow, migrations, models, toIR} from '../src/index'

// Define a model entirely through the capitalized namespaced API.
@models.model()
class Widget extends models.Model {
  id = models.ID()
  name = models.Text({unique: true})
  price = models.Int({nullable: true})
  slug = models.Text({index: true})
  status = models.Enum(['active', 'archived'] as const)
}

describe('namespaced public API', () => {
  it('models.* exposes capitalized field types + Model', () => {
    expect(models.Model).toBeTypeOf('function')
    for (const k of ['ID', 'Text', 'Int', 'Boolean', 'Timestamp', 'Enum', 'ForeignKey', 'HasMany']) {
      expect(models[k as keyof typeof models], k).toBeTypeOf('function')
    }
  })

  it('Enum column derives an IN(...) CHECK constraint in the IR', () => {
    const ir = toIR([getModelDefinitionOrThrow(Widget)])
    const status = ir.entities.Widget.fields.find(f => f.name === 'status')
    expect(status?.column?.check).toBe(`"status" IN ('active', 'archived')`)
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

  it('a {index: true} column surfaces as an entity index in the IR', () => {
    const ir = toIR([getModelDefinitionOrThrow(Widget)])
    expect(ir.entities.Widget.indexes).toEqual([
      {name: 'widget_slug_idx', table: 'widget', columns: ['slug'], unique: false}
    ])
  })

  it('migrations.* exposes the named (Django-style) schema operations', () => {
    for (const k of [
      'defineMigration', 'schema', 'runSql', 'run',
      'createTable', 'dropTable', 'addColumn', 'dropColumn', 'alterColumn',
      'addForeignKey', 'dropForeignKey', 'addIndex', 'dropIndex', 'renameColumn'
    ]) {
      expect(migrations[k as keyof typeof migrations], k).toBeTypeOf('function')
    }
  })
})
