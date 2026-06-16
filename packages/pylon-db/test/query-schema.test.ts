import {describe, expect, it} from 'vitest'
import {
  Model,
  boolean,
  buildQuerySchema,
  enumOf,
  foreignKey,
  getModelDefinitionOrThrow,
  hasMany,
  id,
  int,
  model,
  numeric,
  publicFieldNames,
  type Relation,
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

  it('memoizes — same (definition, depth) returns the same schema instance', () => {
    const def = getModelDefinitionOrThrow(Item)
    expect(buildQuerySchema(def)).toBe(buildQuerySchema(def))
  })
})

@model()
class Author extends Model {
  id = id()
  name = text()
}
@model()
class Book extends Model {
  id = id()
  title = text()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
  reviews = hasMany(() => Review, {foreignKey: 'bookId'})
}
@model()
class Review extends Model {
  id = id()
  body = text()
  bookId = foreignKey(() => Book)
  declare book: Relation<Book>
}

const bookDef = getModelDefinitionOrThrow(Book)

describe('buildQuerySchema — relations (phase 2)', () => {
  it('exposes a relation field per relation at depth ≥ 1', () => {
    const schema = buildQuerySchema(bookDef)
    expect([...schema.relations.keys()].sort()).toEqual(['author', 'reviews'])
  })

  it('flags to-many relations (hasMany) so the parser wraps them in {some}', () => {
    const schema = buildQuerySchema(bookDef)
    expect(schema.relations.get('author')!.toMany).toBe(false) // belongsTo
    expect(schema.relations.get('reviews')!.toMany).toBe(true) // hasMany
  })

  it('relations default to internal visibility (public opt-in is phase 3)', () => {
    const schema = buildQuerySchema(bookDef)
    expect(schema.relations.get('author')!.visibility).toBe('internal')
  })

  it("a relation's target schema exposes the target's own fields", () => {
    const author = buildQuerySchema(bookDef).relations.get('author')!.target()
    expect(author.byName.has('name')).toBe(true)
  })

  it('bounds depth: the target schema (depth-1) has no relations of its own', () => {
    const author = buildQuerySchema(bookDef).relations.get('author')!.target()
    expect(author.relations.size).toBe(0)
  })

  it('depth 0 yields no relations at all', () => {
    expect(buildQuerySchema(bookDef, 0).relations.size).toBe(0)
  })
})

@model({
  query: {
    fields: {
      authorName: {path: 'author.name'},
      recent: {toWhere: () => ({createdAt: {gt: new Date(0)}})}
    },
    public: ['title', 'recent']
  }
})
class Post extends Model {
  id = id()
  title = text()
  body = text()
  createdAt = timestamp()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
}

const postSchema = buildQuerySchema(getModelDefinitionOrThrow(Post))

describe('buildQuerySchema — virtual/alias fields & public allowlist (phase 3)', () => {
  it('adds an alias field with kind "alias" and its path', () => {
    const f = postSchema.byName.get('authorName')!
    expect(f.kind).toBe('alias')
    expect(f.path).toBe('author.name')
  })

  it('adds a virtual field with kind "virtual" and a toWhere handler', () => {
    const f = postSchema.byName.get('recent')!
    expect(f.kind).toBe('virtual')
    expect(typeof f.toWhere).toBe('function')
  })

  it('public allowlist makes ONLY listed fields public', () => {
    expect(postSchema.byName.get('title')!.visibility).toBe('public') // listed
    expect(postSchema.byName.get('recent')!.visibility).toBe('public') // listed
    expect(postSchema.byName.get('body')!.visibility).toBe('internal') // not listed
    expect(postSchema.byName.get('createdAt')!.visibility).toBe('internal') // not listed
  })

  it('publicFieldNames reflects the allowlist', () => {
    expect(publicFieldNames(postSchema).sort()).toEqual(['recent', 'title'])
  })
})
