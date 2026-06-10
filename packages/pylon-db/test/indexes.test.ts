import {describe, expect, it} from 'vitest'
import {getModelDefinitionOrThrow, id, int, model, Model, text, toIR} from '../src/index'

@model({
  table: 'membership',
  indexes: [
    {columns: ['orgId', 'userId'], unique: true}, // composite unique
    {columns: ['userId']} // single via the model API, default name
  ]
})
class Membership extends Model {
  id = id()
  orgId = int({column: 'org_id'})
  userId = int({column: 'user_id'})
  role = text({index: true}) // single-column via field option
}

describe('composite / multi-column indexes (model `indexes` option)', () => {
  const ir = toIR([getModelDefinitionOrThrow(Membership)])
  const indexes = ir.entities.Membership.indexes ?? []
  const byName = Object.fromEntries(indexes.map(i => [i.name, i]))

  it('emits a composite UNIQUE index (property names → column names)', () => {
    expect(byName['membership_org_id_user_id_idx']).toEqual({
      name: 'membership_org_id_user_id_idx',
      table: 'membership',
      columns: ['org_id', 'user_id'],
      unique: true
    })
  })

  it('emits a single-column index declared via the model API', () => {
    expect(byName['membership_user_id_idx']).toMatchObject({columns: ['user_id'], unique: false})
  })

  it('still emits field-level {index:true} indexes alongside', () => {
    expect(byName['membership_role_idx']).toMatchObject({columns: ['role'], unique: false})
  })
})
