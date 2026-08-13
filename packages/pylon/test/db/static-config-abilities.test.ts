import {describe, it, expect} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  manager,
  id,
  text,
  can,
  filter,
  runWithAppContext,
  type ModelConfig
} from '../src/index'
import {getModelDefinition} from '../src/registry'

describe('static config', () => {
  it('applies typed config declared as a static member', () => {
    class Doc extends Model {
      static objects = manager(Doc)
      static config = {
        table: 'documents',
        secure: true,
        indexes: [{columns: ['orgId', 'slug']}]
      } satisfies ModelConfig<Doc>
      id = id()
      orgId = text()
      slug = text()
    }
    new Pylon({db: {models: [Doc]}})

    const def = getModelDefinition(Doc)!
    expect(def.tableName).toBe('documents')
    expect(def.secure).toBe(true)
    expect(def.indexes).toHaveLength(1)
  })

  it('static config.table overrides the derived (class-name) table', () => {
    class Thing extends Model {
      static objects = manager(Thing)
      static config = {table: 'from_config', secure: true} satisfies ModelConfig<Thing>
      id = id()
    }
    new Pylon({db: {models: [Thing]}})

    const def = getModelDefinition(Thing)!
    expect(def.tableName).toBe('from_config')
    expect(def.secure).toBe(true)
  })
})

describe('static abilities', () => {
  it('co-located rules govern the model — no defineAbilities, no {subjects}', () => {
    class Note extends Model {
      static objects = manager(Note)
      id = id()
      ownerId = text()
      body = text()

      static abilities(p: {id?: string} | undefined, can: any) {
        can('read', {ownerId: p?.id})
        can('update', {ownerId: p?.id})
      }
    }
    new Pylon({db: {models: [Note]}})

    runWithAppContext({principal: {id: 'u1'}}, () => {
      // query scoping: the owner condition is fed into the row policy
      expect(filter('read', Note)).toEqual({OR: [{ownerId: 'u1'}]})

      const mine = Object.assign(new Note(), {ownerId: 'u1'})
      const theirs = Object.assign(new Note(), {ownerId: 'u2'})
      expect(can('read', mine)).toBe(true)
      expect(can('read', theirs)).toBe(false)
      expect(can('update', mine)).toBe(true)
      expect(can('delete', mine)).toBe(false) // an unstated action is denied
    })
  })
})
