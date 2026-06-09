import {describe, expect, it} from 'vitest'
import {emptyIR, mergeIR, toSDL, toDDL, type PylonIR} from '../src/index'

describe('IR is ORM-agnostic — a plain Pylon app needs no entities', () => {
  // A vanilla Pylon app: resolvers returning a plain DTO. No persistence, no
  // ORM, no `entities`. The IR + projection handle it completely.
  const ir: PylonIR = {
    ...emptyIR(),
    objects: {
      Status: {
        name: 'Status',
        fields: [
          {name: 'ok', type: {kind: 'scalar', name: 'Boolean', nullable: false}, exposed: true},
          {name: 'uptime', type: {kind: 'scalar', name: 'Int', nullable: false}, exposed: true},
          // an internal field a resolver computes but never exposes
          {name: 'secret', type: {kind: 'scalar', name: 'String', nullable: false}, exposed: false}
        ]
      }
    },
    operations: [
      {root: 'Query', name: 'health', args: [], returns: {kind: 'ref', name: 'Status', nullable: false}},
      {
        root: 'Query',
        name: 'echo',
        args: [{name: 'msg', type: {kind: 'scalar', name: 'String', nullable: false}, exposed: true}],
        returns: {kind: 'scalar', name: 'String', nullable: true}
      }
    ]
  }

  const sdl = toSDL(ir)

  it('projects operations with args and nullability', () => {
    expect(sdl).toMatch(/type Query \{/)
    expect(sdl).toMatch(/health: Status!/)
    expect(sdl).toMatch(/echo\(msg: String!\): String\b/)
  })

  it('projects a plain object type and honours per-field visibility', () => {
    expect(sdl).toMatch(/type Status \{/)
    expect(sdl).toMatch(/ok: Boolean!/)
    expect(sdl).toMatch(/uptime: Int!/)
    expect(sdl).not.toMatch(/secret/) // exposed:false
  })

  it('emits no entity/table machinery when there are no entities', () => {
    expect(Object.keys(ir.entities)).toHaveLength(0)
    expect(sdl).not.toMatch(/implements/)
  })
})

describe('the SAME IR object drives GraphQL and SQL projections', () => {
  // One hand-built entity (as if a contributor produced it) projected two ways.
  const ir = mergeIR({
    entities: {
      Widget: {
        name: 'Widget',
        table: 'widget',
        abstract: false,
        primaryKey: 'id',
        implements: ['IModel'],
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
            column: {name: 'label', sqlType: 'text', primaryKey: false, autoIncrement: false, unique: true, nullable: false}
          },
          {
            // persisted but hidden from the API — one field, two answers
            name: 'secretKey',
            type: {kind: 'scalar', name: 'String', nullable: true},
            exposed: false,
            column: {name: 'secret_key', sqlType: 'text', primaryKey: false, autoIncrement: false, unique: false, nullable: true}
          }
        ]
      }
    }
  })

  it('GraphQL projection drops the hidden field', () => {
    const sdl = toSDL(ir)
    expect(sdl).toMatch(/type Widget implements IModel \{/)
    expect(sdl).toMatch(/label: String!/)
    expect(sdl).not.toMatch(/secretKey|secret_key/)
  })

  it('SQL projection keeps the hidden field as a column', () => {
    const ddl = toDDL(ir.entities.Widget)
    expect(ddl).toMatch(/CREATE TABLE "widget"/)
    expect(ddl).toMatch(/"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY/)
    expect(ddl).toMatch(/"label" text UNIQUE NOT NULL/)
    expect(ddl).toMatch(/"secret_key" text/) // present in the table
  })
})

describe('toSDL drops empty interfaces (invalid GraphQL otherwise)', () => {
  // An interface with no exposed fields is invalid SDL — e.g. the ORM's `Model`
  // base, whose members are all excluded. It must be dropped AND stripped from
  // every `implements` clause. (Regression: this broke a real `pylon build`.)
  const ir: PylonIR = {
    ...emptyIR(),
    interfaces: {IModel: {name: 'IModel', fields: []}},
    objects: {
      User: {
        name: 'User',
        implements: ['IModel'],
        fields: [
          {name: 'id', type: {kind: 'scalar', name: 'ID', nullable: false}, exposed: true}
        ]
      }
    }
  }
  const sdl = toSDL(ir)

  it('omits the empty interface definition', () => {
    expect(sdl).not.toMatch(/interface IModel/)
  })

  it('strips the dropped interface from implements', () => {
    expect(sdl).toMatch(/type User \{/)
    expect(sdl).not.toMatch(/implements/)
  })
})
