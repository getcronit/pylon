import {describe, expect, it} from 'vitest'
import {tableSpecOf, type Entity} from '@getcronit/pylon/ir'
import {buildHistoricalModels} from '@/db/historical-models'
import {validateInstance} from '@/db/validation'
import {getModelDefinitionOrThrow} from '@/db/registry'

const gadget: Entity = {
  name: 'Gadget',
  table: 'gadget',
  abstract: false,
  primaryKey: 'id',
  implements: [],
  fields: [
    {
      name: 'id',
      type: {kind: 'scalar', name: 'ID', nullable: false},
      exposed: true,
      column: {name: 'id', sqlType: 'bigint', primaryKey: true, autoIncrement: true, unique: false, nullable: false}
    },
    {
      name: 'label',
      type: {kind: 'scalar', name: 'String', nullable: false},
      exposed: true,
      column: {name: 'label', sqlType: 'text', primaryKey: false, autoIncrement: false, unique: false, nullable: false}
    }
  ]
}

describe('buildHistoricalModels — managers reconstructed from IR state', () => {
  it('exposes a working .objects manager for a known entity', () => {
    const models = buildHistoricalModels({Gadget: tableSpecOf(gadget)})
    const G = models.get('Gadget')
    expect(G.objects).toBeDefined()
    expect(G.objects.filter).toBeTypeOf('function')
    expect(G.objects.create).toBeTypeOf('function')
    // same handle is cached across calls
    expect(models.get('Gadget')).toBe(G)
  })

  it('throws a helpful error for an entity not present in this historical state', () => {
    const models = buildHistoricalModels({Gadget: tableSpecOf(gadget)})
    expect(() => models.get('Ghost')).toThrow(/No historical model "Ghost"/)
  })

  // Regression: a `text[]` array column (sqlType 'text' + `array: true`) is
  // persisted with the `array` flag on the IR spec, not as a distinct sqlType.
  // The reconstructed column MUST carry that flag — otherwise validation treats
  // it as a scalar `text` column and rejects its list value ("must be a string"),
  // which broke every data migration that wrote an array column via models.get().
  it('reconstructs array columns so list values validate (not "must be a string")', () => {
    const withArray: Entity = {
      name: 'Mailish',
      table: 'mailish',
      abstract: false,
      primaryKey: 'id',
      implements: [],
      fields: [
        {
          name: 'id',
          type: {kind: 'scalar', name: 'ID', nullable: false},
          exposed: true,
          column: {name: 'id', sqlType: 'bigint', primaryKey: true, autoIncrement: true, unique: false, nullable: false}
        },
        {
          name: 'toAddresses',
          type: {kind: 'list', of: {kind: 'scalar', name: 'String', nullable: false}, nullable: false},
          exposed: true,
          column: {name: 'to_addresses', sqlType: 'text', array: true, primaryKey: false, autoIncrement: false, unique: false, nullable: false}
        }
      ]
    }
    const models = buildHistoricalModels({Mailish: tableSpecOf(withArray)})
    const def = getModelDefinitionOrThrow((models.get('Mailish').objects as any).ctor)
    const col = def.columns.find((c: any) => c.propertyKey === 'toAddresses')
    expect(col.array).toBe(true)
    // A list value must produce no validation issue (pre-fix: "must be a string").
    expect(validateInstance(def, {id: '1', toAddresses: ['a@x.test', 'b@x.test']})).toEqual([])
    // And a non-array is still rejected — as an array-type issue, not a string one.
    const bad = validateInstance(def, {id: '1', toAddresses: 'a@x.test'})
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({path: 'toAddresses', code: 'type', params: {expected: 'array'}})
  })
})
