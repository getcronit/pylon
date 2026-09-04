import {describe, expect, it} from 'vitest'
import {
  collapseInterfaceTwins,
  mergeFields,
  emptyIR,
  mergeIR,
  pruneUnreferencedEnums,
  toSDL,
  type Entity,
  type ObjectType
} from '@/ir/index'

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

describe('collapseInterfaceTwins — STI interface unification', () => {
  const f = (name: string, exposed = true) => ({
    name,
    type: {kind: 'scalar' as const, name: 'String', nullable: true},
    exposed
  })
  const sub = (name: string, own: string) => ({
    name,
    table: 'asset',
    abstract: false,
    primaryKey: 'id',
    // analyzer view: the I-twin + a property-named alias `Item`; ORM adds `Asset`.
    implements: ['Asset', 'IAsset', 'Item'],
    fields: [f('id'), f('name'), f(own)]
  })
  const build = () => {
    const ir = emptyIR()
    ir.entities.Asset = {
      name: 'Asset',
      table: 'asset',
      abstract: false,
      primaryKey: 'id',
      implements: [],
      fields: [f('id'), f('name'), {...f('url'), exposed: true}]
    }
    ir.interfaces.Asset = {name: 'Asset', fields: [f('id'), f('name')]}
    ir.interfaces.IAsset = {name: 'IAsset', fields: [f('id'), f('name')]}
    // property-named alias carrying an over-broad field set (incl. a hidden col).
    ir.interfaces.Item = {name: 'Item', fields: [f('id'), f('name'), f('s3Key', false)]}
    ir.entities.Image = sub('Image', 'width')
    ir.entities.Doc = sub('Doc', 'pages')
    return ir
  }

  it('folds the analyzer I-twin AND property-named aliases into the one STI interface', () => {
    const ir = collapseInterfaceTwins(build())
    expect(ir.interfaces.IAsset).toBeUndefined()
    expect(ir.interfaces.Item).toBeUndefined() // the property-named alias is folded
    expect(ir.interfaces.Asset).toBeDefined()
    // subclasses now implement exactly the base interface (aliases collapsed away).
    expect(ir.entities.Image.implements).toEqual(['Asset'])
    expect(ir.entities.Doc.implements).toEqual(['Asset'])
  })
})

describe('mergeFields — a hidden m2m relation never shadows an exposed accessor', () => {
  const list = {kind: 'list' as const, of: {kind: 'ref' as const, name: 'Media', nullable: false}, nullable: false}
  it('keeps the exposed no-args accessor in the schema, retains relation meta for migrations', () => {
    // e.g. `media()` accessor (exposed, NO args) + `$media = m2m(Media)` (strips to `media`, hidden).
    const accessor = {name: 'media', type: list, exposed: true}
    const relation = {name: 'media', type: list, exposed: false, relation: {kind: 'manyToMany' as const, target: 'Media'}}
    const merged = mergeFields([accessor], [relation])
    const m = merged.find(f => f.name === 'media')!
    expect(m.exposed).toBe(true) // the accessor wins the schema slot (not shadowed)
    expect(m.relation?.kind).toBe('manyToMany') // join-table meta retained for migrations
  })
})
