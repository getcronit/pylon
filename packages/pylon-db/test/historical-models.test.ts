import {describe, expect, it} from 'vitest'
import {tableSpecOf, type Entity} from '@getcronit/pylon-ir'
import {buildHistoricalModels} from '../src/historical-models'

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
})
