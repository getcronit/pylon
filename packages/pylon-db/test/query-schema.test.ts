import {describe, expect, it} from 'vitest'
import {
  Model,
  boolean,
  buildQuerySchema,
  enumOf,
  getModelDefinitionOrThrow,
  id,
  int,
  model,
  numeric,
  publicFieldNames,
  text,
  timestamp
} from '../src/index'

@model({search: {columns: ['title']}})
class Item extends Model {
  id = id() // bigint
  title = text() // textual
  body = text({column: 'body_text'}) // textual; column name differs
  price = numeric({precision: 10, scale: 2})
  stock = int()
  active = boolean({default: true})
  status = enumOf(['DRAFT', 'PUBLISHED'] as const) // text + enumValues
  createdAt = timestamp()
  $secret = text({nullable: true}) // hidden
}

const schema = buildQuerySchema(getModelDefinitionOrThrow(Item))

describe('buildQuerySchema', () => {
  it('derives one queryable field per non-hidden, non-tsvector own column', () => {
    expect(schema.fields.map(f => f.name).sort()).toEqual([
      'active',
      'body',
      'createdAt',
      'id',
      'price',
      'status',
      'stock',
      'title'
    ])
  })

  it('excludes hidden columns entirely', () => {
    expect(schema.fields.some(f => f.name.includes('secret'))).toBe(false)
    expect(schema.byName.has('$secret')).toBe(false)
  })

  it('routes the synthesized tsvector to the FTS search target, not a field', () => {
    expect(schema.fields.some(f => f.sqlType === 'tsvector')).toBe(false)
    expect(schema.search.fts).toBeDefined()
    expect(schema.search.fts!.language).toBe('english')
  })

  it('resolves a field by its property key OR its physical column name', () => {
    expect(schema.byName.get('body')).toBe(schema.byName.get('body_text'))
  })

  it('marks text columns textual; numeric / date / bool not', () => {
    expect(schema.byName.get('title')!.textual).toBe(true)
    expect(schema.byName.get('stock')!.textual).toBe(false)
    expect(schema.byName.get('createdAt')!.textual).toBe(false)
  })

  it('derives operators from the value type', () => {
    expect(schema.byName.get('stock')!.ops).toEqual(expect.arrayContaining(['eq', 'gt', 'lte']))
    expect(schema.byName.get('title')!.ops).toEqual(
      expect.arrayContaining(['eq', 'contains', 'startsWith'])
    )
    // enum is stored as text but is equality-only (no substring ops)
    expect(schema.byName.get('status')!.ops).not.toContain('contains')
  })

  it('defaults own columns to public visibility (Phase 1)', () => {
    expect(schema.fields.every(f => f.visibility === 'public')).toBe(true)
    expect(publicFieldNames(schema)).toContain('title')
  })

  it('memoizes — same definition returns the same schema instance', () => {
    const def = getModelDefinitionOrThrow(Item)
    expect(buildQuerySchema(def)).toBe(buildQuerySchema(def))
  })
})
