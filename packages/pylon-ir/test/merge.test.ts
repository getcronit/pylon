import {describe, expect, it} from 'vitest'
import {
  emptyIR,
  mergeIR,
  pruneUnreferencedEnums,
  toSDL,
  type Entity,
  type ObjectType
} from '../src/index'

const userObject: ObjectType = {
  name: 'User',
  fields: [
    {name: 'id', type: {kind: 'scalar', name: 'Number', nullable: false}, exposed: true},
    {name: 'secret', type: {kind: 'scalar', name: 'String', nullable: false}, exposed: true}
  ]
}

const userEntity: Entity = {
  name: 'User',
  table: 'user',
  abstract: false,
  primaryKey: 'id',
  implements: [],
  fields: [
    {name: 'id', type: {kind: 'scalar', name: 'ID', nullable: false}, exposed: true, column: {name: 'id', sqlType: 'bigint', primaryKey: true, autoIncrement: true, unique: false, nullable: false}},
    {name: 'secret', type: {kind: 'scalar', name: 'String', nullable: true}, exposed: false, column: {name: 'secret', sqlType: 'text', primaryKey: false, autoIncrement: false, unique: false, nullable: true}}
  ]
}

describe('mergeIR — an entity is authoritative over a same-named object', () => {
  const merged = mergeIR(
    {...emptyIR(), objects: {User: userObject}},
    {entities: {User: userEntity}}
  )

  it('drops the plain object when an entity of the same name exists', () => {
    expect(merged.objects.User).toBeUndefined()
    expect(merged.entities.User).toBeDefined()
  })

  it('renders exactly one User reflecting the entity (ID, hidden secret)', () => {
    const sdl = toSDL(merged)
    expect((sdl.match(/type User\b/g) ?? []).length).toBe(1)
    expect(sdl).toMatch(/id: ID!/)
    expect(sdl).not.toMatch(/secret/)
  })
})

describe('mergeIR — computed fields (model methods) fold into the entity', () => {
  // The type-checker saw a `displayName(): string` method on the model class.
  const withComputed: ObjectType = {
    name: 'User',
    fields: [
      ...userObject.fields,
      {name: 'displayName', type: {kind: 'scalar', name: 'String', nullable: false}, exposed: true}
    ]
  }
  const merged = mergeIR(
    {...emptyIR(), objects: {User: withComputed}},
    {entities: {User: userEntity}}
  )

  it('keeps the method field on the entity (column metadata still authoritative)', () => {
    const fields = Object.fromEntries(merged.entities.User.fields.map(f => [f.name, f]))
    expect(fields.displayName).toBeDefined() // computed method preserved
    expect(fields.id.column?.sqlType).toBe('bigint') // entity (ORM) won for the column
    expect(fields.secret.exposed).toBe(false) // entity's hidden flag won
  })

  it('renders the computed field in SDL', () => {
    expect(toSDL(merged)).toMatch(/displayName: String!/)
  })
})

describe('pruneUnreferencedEnums', () => {
  it('drops enums no field/arg/return references, keeps referenced ones', () => {
    const ir = emptyIR()
    ir.enums.UserRole = {name: 'UserRole', values: ['ADMIN', 'USER']}
    ir.enums.Orphan = {name: 'Orphan', values: ['A', 'B']}
    ir.entities.User = {
      name: 'User',
      table: 'user',
      abstract: false,
      implements: [],
      fields: [
        {name: 'role', type: {kind: 'ref', name: 'UserRole', nullable: false}, exposed: true}
      ]
    }
    const pruned = pruneUnreferencedEnums(ir)
    expect(pruned.enums.UserRole).toBeDefined()
    expect(pruned.enums.Orphan).toBeUndefined()
  })

  it('keeps an enum referenced only through a list type or an operation arg', () => {
    const ir = emptyIR()
    ir.enums.Tag = {name: 'Tag', values: ['A']}
    ir.enums.Status = {name: 'Status', values: ['OPEN']}
    ir.objects.Post = {
      name: 'Post',
      fields: [
        {name: 'tags', type: {kind: 'list', of: {kind: 'ref', name: 'Tag', nullable: false}, nullable: false}, exposed: true}
      ]
    }
    ir.operations.push({
      root: 'Query',
      name: 'byStatus',
      args: [{name: 'status', type: {kind: 'ref', name: 'Status', nullable: false}, exposed: true}],
      returns: {kind: 'scalar', name: 'Int', nullable: false}
    })
    const pruned = pruneUnreferencedEnums(ir)
    expect(pruned.enums.Tag).toBeDefined()
    expect(pruned.enums.Status).toBeDefined()
  })
})
