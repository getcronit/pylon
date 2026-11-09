import {describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  boolean,
  enumOf,
  foreignKey,
  getModelDefinitionOrThrow,
  hasMany,
  id,
  int,
  numeric,
  type ModelConfig,
  type Relation,
  text,
  timestamp
} from '@/db/index'
import {parseSearchQuery} from '@/db/query-parser'

// Exercises every column kind the parser coerces / searches: text (default
// search + equality), numeric/int (number coercion + comparators), boolean,
// enum (raw, never coerced), timestamp (Date coercion), a custom column name,
// and a hidden ($-prefixed) column that must stay out of the default search.
class Product extends Model {
  id = id() // bigint — not textual
  title = text() // textual
  body = text({column: 'body_text'}) // textual; column name differs from property
  price = numeric({precision: 10, scale: 2}) // numeric → number
  stock = int() // integer → number
  active = boolean({default: true}) // boolean
  status = enumOf(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const) // text + enumValues
  createdAt = timestamp() // timestamptz → Date
  $secret = text({nullable: true}) // hidden — excluded from default search
}

// One textual column → default search returns a bare predicate (no OR wrapper).
class Tag extends Model {
  id = id()
  label = text()
}

// A model WITH a full-text index → default search routes through the tsvector.
class Doc extends Model {
  static config = {search: {columns: ['title', 'body']}} satisfies ModelConfig<Doc>
  id = id()
  title = text()
  body = text()
}

// A trigram model → default search ORs index-backed ILIKE substring over ONLY
// the declared columns (names/identifiers FTS tokenizes poorly), not every text
// column. `notes` is textual but excluded because it isn't in the trigram set.
class Lead extends Model {
  static config = {trigram: {columns: ['email', 'phone']}} satisfies ModelConfig<Lead>
  id = id()
  email = text()
  phone = text()
  notes = text()
}

// A mixed model → FTS (prose `bio`) OR trigram (`handle`), OR-ed in one bare term.
class Author extends Model {
  static config = {
    search: {columns: ['bio']},
    trigram: {columns: ['handle']}
  } satisfies ModelConfig<Author>
  id = id()
  handle = text()
  bio = text()
}

// Relation models for the phase-2 path tests: Prod —belongsTo→ Brand, and
// Prod —hasMany→ Variant (a to-many hop → `{some: …}`).
class Brand extends Model {
  id = id()
  name = text()
  country = text()
}
class Variant extends Model {
  id = id()
  sku = text()
  qty = int()
  productId = foreignKey(() => Prod)
  declare product: Relation<Prod>
}
class Prod extends Model {
  id = id()
  title = text()
  brandId = foreignKey(() => Brand)
  declare brand: Relation<Brand>
  variants = hasMany(() => Variant, {foreignKey: 'productId'})
}

// Phase-3 config: an alias (`brandName` → `brand.name`), a virtual derived field
// (`cheap` → a price predicate), and a curated public allowlist.
class Catalog extends Model {
  static config = {
    query: {
      fields: {
        brandName: {path: 'brand.name'},
        cheap: {toWhere: (_op: any, v: any) => (v === 'true' ? {price: {lt: 10}} : {price: {gte: 10}})}
      },
      public: ['title', 'cheap']
    }
  } satisfies ModelConfig<Catalog>
  id = id()
  title = text()
  price = numeric({precision: 10, scale: 2})
  brandId = foreignKey(() => Brand)
  declare brand: Relation<Brand>
}

new Pylon({db: {models: [Product, Tag, Doc, Lead, Author, Brand, Variant, Prod, Catalog]}})

const productDef = getModelDefinitionOrThrow(Product)
const tagDef = getModelDefinitionOrThrow(Tag)
const docDef = getModelDefinitionOrThrow(Doc)
const prodDef = getModelDefinitionOrThrow(Prod)
const catalogDef = getModelDefinitionOrThrow(Catalog)
const leadDef = getModelDefinitionOrThrow(Lead)
const authorDef = getModelDefinitionOrThrow(Author)
const parse = (q: string) => parseSearchQuery(q, productDef)

/** propertyKey of the synthesized tsvector column (avoids hardcoding its name). */
const ftsKey = docDef.columns.find(c => c.sqlType === 'tsvector')!.propertyKey
/** Sorted property keys of an OR's clauses (for order-independent assertions). */
const orKeys = (w: any): string[] =>
  (w.OR as any[]).map(c => Object.keys(c)[0]).sort()

describe('parseSearchQuery', () => {
  describe('empty / whitespace input', () => {
    it('returns no constraint for an empty string', () => {
      expect(parse('')).toEqual({})
    })
    it('returns no constraint for whitespace only', () => {
      expect(parse('   ')).toEqual({})
      expect(parse('\t\n ')).toEqual({})
    })
  })

  describe('default search (bare terms)', () => {
    it('ORs a case-insensitive contains over every textual, non-hidden column', () => {
      const w = parse('hello') as any
      // title, body, and the enum (stored as text) — NOT id/price/stock/active/
      // createdAt (non-text) or $secret (hidden).
      expect(orKeys(w)).toEqual(['body', 'status', 'title'])
      expect(w.OR).toEqual(
        expect.arrayContaining([
          {title: {contains: 'hello', mode: 'insensitive'}},
          {body: {contains: 'hello', mode: 'insensitive'}},
          {status: {contains: 'hello', mode: 'insensitive'}}
        ])
      )
    })

    it('excludes hidden and non-textual columns', () => {
      const keys = orKeys(parse('x'))
      for (const k of ['$secret', 'id', 'price', 'stock', 'active', 'createdAt']) {
        expect(keys).not.toContain(k)
      }
    })

    it('keeps a quoted phrase (with spaces) intact', () => {
      const w = parse('"hello world"') as any
      expect(w.OR).toEqual(
        expect.arrayContaining([{title: {contains: 'hello world', mode: 'insensitive'}}])
      )
    })

    it('returns a bare predicate (no OR) when only one column is textual', () => {
      expect(parseSearchQuery('blue', tagDef)).toEqual({
        label: {contains: 'blue', mode: 'insensitive'}
      })
    })

    it('a trailing * makes the default search a prefix (startsWith)', () => {
      const w = parse('hel*') as any
      expect(orKeys(w)).toEqual(['body', 'status', 'title'])
      expect(w.OR).toEqual(
        expect.arrayContaining([{title: {startsWith: 'hel', mode: 'insensitive'}}])
      )
    })

    it('a lone * constrains nothing', () => {
      expect(parse('*')).toEqual({})
    })

    it('routes through the tsvector column when the model has a full-text index', () => {
      expect(parseSearchQuery('hello', docDef)).toEqual({[ftsKey]: {search: 'hello'}})
      // a quoted phrase stays one term → one search; unquoted words are
      // separate terms AND-ed together.
      expect(parseSearchQuery('"hello world"', docDef)).toEqual({
        [ftsKey]: {search: 'hello world'}
      })
      expect(parseSearchQuery('hello world', docDef)).toEqual({
        AND: [{[ftsKey]: {search: 'hello'}}, {[ftsKey]: {search: 'world'}}]
      })
    })

    it('passes a prefix flag to the tsvector search for a trailing *', () => {
      expect(parseSearchQuery('hel*', docDef)).toEqual({
        [ftsKey]: {search: 'hel', prefix: true}
      })
    })

    it('routes a bare term to ONLY the trigram columns (not every text column)', () => {
      // `email` + `phone` are the trigram set; `notes` (textual) is excluded.
      expect(parseSearchQuery('acme', leadDef)).toEqual({
        OR: [
          {email: {contains: 'acme', mode: 'insensitive'}},
          {phone: {contains: 'acme', mode: 'insensitive'}}
        ]
      })
    })

    it('uses startsWith on trigram columns for a trailing *', () => {
      expect(parseSearchQuery('acme*', leadDef)).toEqual({
        OR: [
          {email: {startsWith: 'acme', mode: 'insensitive'}},
          {phone: {startsWith: 'acme', mode: 'insensitive'}}
        ]
      })
    })

    it('ORs FTS and trigram together for a mixed model', () => {
      const fts = authorDef.columns.find(c => c.sqlType === 'tsvector')!.propertyKey
      expect(parseSearchQuery('acme', authorDef)).toEqual({
        OR: [
          {[fts]: {search: 'acme'}},
          {handle: {contains: 'acme', mode: 'insensitive'}}
        ]
      })
    })
  })

  describe('field:value equality + coercion', () => {
    it('keeps text values as raw strings', () => {
      expect(parse('title:hello')).toEqual({title: 'hello'})
    })
    it('coerces integer and numeric columns to numbers', () => {
      expect(parse('stock:5')).toEqual({stock: 5})
      expect(parse('price:9.99')).toEqual({price: 9.99})
    })
    it('coerces booleans (true / 1 are true, anything else false)', () => {
      expect(parse('active:true')).toEqual({active: true})
      expect(parse('active:1')).toEqual({active: true})
      expect(parse('active:false')).toEqual({active: false})
      expect(parse('active:0')).toEqual({active: false})
    })
    it('never coerces enum values — they stay raw strings', () => {
      expect(parse('status:PUBLISHED')).toEqual({status: 'PUBLISHED'})
    })
    it('coerces date/timestamp columns to Date', () => {
      const w = parse('createdAt:2024-01-01') as any
      expect(w.createdAt).toBeInstanceOf(Date)
      expect(w.createdAt.getTime()).toBe(new Date('2024-01-01').getTime())
    })
    it('falls back to the raw string when a number/date cannot be parsed', () => {
      expect(parse('stock:abc')).toEqual({stock: 'abc'})
      expect(parse('createdAt:notadate')).toEqual({createdAt: 'notadate'})
    })
    it('resolves a field by its column name as well as its property key', () => {
      expect(parse('body_text:foo')).toEqual({body: 'foo'})
    })
  })

  describe('field comparators, wildcards, and EXISTS', () => {
    it('maps > >= < <= to gt / gte / lt / lte', () => {
      expect(parse('stock:>5')).toEqual({stock: {gt: 5}})
      expect(parse('stock:>=5')).toEqual({stock: {gte: 5}})
      expect(parse('stock:<5')).toEqual({stock: {lt: 5}})
      expect(parse('stock:<=5')).toEqual({stock: {lte: 5}})
    })
    it('matches the two-char operator before the one-char one', () => {
      expect(parse('price:>=9.99')).toEqual({price: {gte: 9.99}})
    })
    it('field:val* is a case-insensitive prefix match on text columns', () => {
      expect(parse('title:hel*')).toEqual({
        title: {startsWith: 'hel', mode: 'insensitive'}
      })
    })
    it('field:* means EXISTS (the column is non-null)', () => {
      expect(parse('body:*')).toEqual({body: {not: null}})
    })
  })

  describe('escaping & quoting (specials become literal)', () => {
    it('a backslash-escaped colon is part of the value, not a field separator', () => {
      expect(parse('title:a\\:b')).toEqual({title: 'a:b'})
    })
    it('an escaped colon with no real field falls back to a default search', () => {
      const w = parse('foo\\:bar') as any
      expect(w.OR).toEqual(
        expect.arrayContaining([{title: {contains: 'foo:bar', mode: 'insensitive'}}])
      )
    })
    it('an escaped trailing * is a literal asterisk, not a wildcard', () => {
      expect(parse('title:a\\*')).toEqual({title: 'a*'})
    })
    it('quotes keep a colon literal in the value', () => {
      expect(parse('title:"a:b"')).toEqual({title: 'a:b'})
    })
    it('a quoted OR is a literal phrase, not the connective', () => {
      const w = parse('"a OR b"') as any
      expect(w.OR).toEqual(
        expect.arrayContaining([{title: {contains: 'a OR b', mode: 'insensitive'}}])
      )
    })
  })

  describe('unknown fields (lenient)', () => {
    it('drops an unknown field entirely', () => {
      expect(parse('nope:bar')).toEqual({})
    })
    it('drops only the unknown term, keeping the rest', () => {
      expect(parse('title:a nope:b')).toEqual({title: 'a'})
    })
    it('drops a negated unknown field', () => {
      expect(parse('-nope:x')).toEqual({})
    })
  })

  describe('negation', () => {
    it('negates with a leading dash', () => {
      expect(parse('-status:DRAFT')).toEqual({NOT: [{status: 'DRAFT'}]})
    })
    it('negates with the NOT keyword (any case)', () => {
      expect(parse('NOT status:DRAFT')).toEqual({NOT: [{status: 'DRAFT'}]})
      expect(parse('not status:DRAFT')).toEqual({NOT: [{status: 'DRAFT'}]})
    })
    it('negates a default-search term', () => {
      const w = parse('-hello') as any
      expect(w.NOT).toHaveLength(1)
      expect(orKeys(w.NOT[0])).toEqual(['body', 'status', 'title'])
    })
    it('negates a parenthesised group', () => {
      expect(parse('NOT (status:DRAFT OR status:ARCHIVED)')).toEqual({
        NOT: [{OR: [{status: 'DRAFT'}, {status: 'ARCHIVED'}]}]
      })
    })
  })

  describe('connectives & precedence', () => {
    it('joins terms with OR', () => {
      expect(parse('status:DRAFT OR status:PUBLISHED')).toEqual({
        OR: [{status: 'DRAFT'}, {status: 'PUBLISHED'}]
      })
    })
    it('accepts OR in any case', () => {
      expect(parse('status:DRAFT or status:PUBLISHED')).toEqual({
        OR: [{status: 'DRAFT'}, {status: 'PUBLISHED'}]
      })
    })
    it('does not treat "or" inside a value as the keyword', () => {
      expect(parse('title:or')).toEqual({title: 'or'})
    })
    it('joins space-separated terms with implicit AND', () => {
      expect(parse('status:PUBLISHED active:true')).toEqual({
        AND: [{status: 'PUBLISHED'}, {active: true}]
      })
    })
    it('accepts the explicit AND keyword', () => {
      expect(parse('status:PUBLISHED AND active:true')).toEqual({
        AND: [{status: 'PUBLISHED'}, {active: true}]
      })
    })
    it('binds OR tighter than AND (Shopify precedence)', () => {
      // `a OR b c`  ≡  `(a OR b) AND c`
      expect(parse('status:DRAFT OR status:PUBLISHED active:true')).toEqual({
        AND: [{OR: [{status: 'DRAFT'}, {status: 'PUBLISHED'}]}, {active: true}]
      })
      // `a b OR c`  ≡  `a AND (b OR c)`
      expect(parse('stock:>0 active:true OR status:DRAFT')).toEqual({
        AND: [{stock: {gt: 0}}, {OR: [{active: true}, {status: 'DRAFT'}]}]
      })
    })
  })

  describe('grouping', () => {
    it('respects parentheses', () => {
      expect(parse('(status:DRAFT OR status:PUBLISHED) active:true')).toEqual({
        AND: [{OR: [{status: 'DRAFT'}, {status: 'PUBLISHED'}]}, {active: true}]
      })
    })
    it('tolerates an unbalanced opening paren', () => {
      expect(parse('(status:DRAFT')).toEqual({status: 'DRAFT'})
    })
  })

  describe('Shopify syntax differences (no ranges / no comma-lists)', () => {
    it('treats a..b as a literal value, not a range (use two comparators)', () => {
      expect(parse('stock:1..10')).toEqual({stock: '1..10'})
      // the Shopify way to express a range:
      expect(parse('stock:>=1 stock:<=10')).toEqual({
        AND: [{stock: {gte: 1}}, {stock: {lte: 10}}]
      })
    })
    it('treats a comma list as a literal value, not IN (use OR)', () => {
      expect(parse('status:DRAFT,PUBLISHED')).toEqual({status: 'DRAFT,PUBLISHED'})
    })
  })

  describe('shape', () => {
    it('returns a single predicate unwrapped (no AND/OR)', () => {
      expect(parse('status:DRAFT')).toEqual({status: 'DRAFT'})
    })
  })

  // The public surface is strict: an unknown/non-queryable field is a hard error
  // (a public consumer should learn their query is wrong, not get silent results).
  // The internal surface (default) stays lenient — a frontend typo degrades to "no
  // constraint" rather than a 500.
  describe('scope: public (strict) vs internal (lenient)', () => {
    it('public scope rejects an unknown field with a helpful error', () => {
      expect(() => parseSearchQuery('nope:bar', productDef, {scope: 'public'})).toThrow(
        /Unknown or non-queryable field "nope"/
      )
    })

    it('the error lists the queryable fields', () => {
      expect(() => parseSearchQuery('nope:bar', productDef, {scope: 'public'})).toThrow(/title/)
    })

    it('public scope accepts a known field', () => {
      expect(parseSearchQuery('status:DRAFT', productDef, {scope: 'public'})).toEqual({
        status: 'DRAFT'
      })
    })

    it('public scope rejects a negated unknown field too', () => {
      expect(() => parseSearchQuery('-nope:x', productDef, {scope: 'public'})).toThrow(
        /Unknown or non-queryable field "nope"/
      )
    })

    it('internal scope (explicit and default) stays lenient', () => {
      expect(parseSearchQuery('nope:bar', productDef, {scope: 'internal'})).toEqual({})
      expect(parseSearchQuery('nope:bar', productDef)).toEqual({})
    })

    it('bare-term search is unaffected by scope', () => {
      expect(parseSearchQuery('hello', productDef, {scope: 'public'})).toEqual(
        parseSearchQuery('hello', productDef)
      )
    })
  })

  // Phase 2: dotted paths walk relations. The WhereInput compiler nests them —
  // to-one as `{rel: pred}`, to-many as `{rel: {some: pred}}`.
  describe('relation paths (phase 2)', () => {
    const parseProd = (q: string, opts?: Parameters<typeof parseSearchQuery>[2]) =>
      parseSearchQuery(q, prodDef, opts)

    it('walks a to-one (belongsTo) relation', () => {
      expect(parseProd('brand.name:nike')).toEqual({brand: {name: 'nike'}})
    })

    it('wraps a to-many (hasMany) relation in {some: …}', () => {
      expect(parseProd('variants.sku:abc')).toEqual({
        variants: {some: {sku: 'abc'}}
      })
    })

    it('carries operators through the relation (prefix, comparator, EXISTS)', () => {
      expect(parseProd('variants.sku:abc*')).toEqual({
        variants: {some: {sku: {startsWith: 'abc', mode: 'insensitive'}}}
      })
      expect(parseProd('variants.qty:>5')).toEqual({variants: {some: {qty: {gt: 5}}}})
      expect(parseProd('brand.country:*')).toEqual({brand: {country: {not: null}}})
    })

    it('composes a relation path with own-column terms (implicit AND)', () => {
      expect(parseProd('title:hat brand.name:nike')).toEqual({
        AND: [{title: 'hat'}, {brand: {name: 'nike'}}]
      })
    })

    it('stops at the depth bound (default 1) — a deeper hop is unknown', () => {
      // Variant (the depth-1 target) is built with no relations, so `product` is
      // not traversable → the whole term drops (lenient).
      expect(parseProd('variants.product.title:x')).toEqual({})
    })

    it('public scope rejects a relation path (relations are internal until opted in)', () => {
      expect(() => parseProd('brand.name:nike', {scope: 'public'})).toThrow(
        /Unknown or non-queryable field "brand.name"/
      )
    })

    it('an unknown leaf field on a known relation is lenient (internal)', () => {
      expect(parseProd('brand.nope:x')).toEqual({})
    })
  })

  // Phase 2 cost guard: cap the boolean-node count on the public surface.
  describe('cost guard (phase 2)', () => {
    it('public scope rejects a query with too many terms', () => {
      expect(() =>
        parseSearchQuery('status:DRAFT status:PUBLISHED active:true', productDef, {
          scope: 'public',
          maxBooleanNodes: 2
        })
      ).toThrow(/too complex/)
    })

    it('internal scope is unbounded', () => {
      expect(() =>
        parseSearchQuery('status:DRAFT status:PUBLISHED active:true', productDef, {
          maxBooleanNodes: 2
        })
      ).not.toThrow()
    })
  })

  // Phase 3: static config {query:{fields, public}} — aliases, virtual fields, and a
  // curated public allowlist.
  describe('virtual fields, aliases & public allowlist (phase 3)', () => {
    const parseCat = (q: string, opts?: Parameters<typeof parseSearchQuery>[2]) =>
      parseSearchQuery(q, catalogDef, opts)

    it('an alias re-paths to a relation field', () => {
      expect(parseCat('brandName:nike')).toEqual({brand: {name: 'nike'}})
    })

    it('a virtual field builds its own predicate from (op, value)', () => {
      expect(parseCat('cheap:true')).toEqual({price: {lt: 10}})
      expect(parseCat('cheap:false')).toEqual({price: {gte: 10}})
    })

    it('a virtual field composes with other terms', () => {
      expect(parseCat('title:hat cheap:true')).toEqual({
        AND: [{title: 'hat'}, {price: {lt: 10}}]
      })
    })

    it('public allowlist: a whitelisted field (incl. virtual) is queryable', () => {
      expect(parseCat('cheap:true', {scope: 'public'})).toEqual({price: {lt: 10}})
      expect(parseCat('title:hat', {scope: 'public'})).toEqual({title: 'hat'})
    })

    it('public allowlist: a non-whitelisted column is rejected', () => {
      // `price` exists as a column but is NOT in the public allowlist
      expect(() => parseCat('price:5', {scope: 'public'})).toThrow(
        /Unknown or non-queryable field "price"/
      )
    })

    it('internally, non-whitelisted columns still work (lenient surface)', () => {
      expect(parseCat('price:5')).toEqual({price: 5})
    })
  })
})
