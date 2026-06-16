import {describe, expect, it} from 'vitest'
import {
  Model,
  boolean,
  enumOf,
  getModelDefinitionOrThrow,
  id,
  int,
  model,
  numeric,
  text,
  timestamp
} from '../src/index'
import {parseSearchQuery} from '../src/query-parser'

// Exercises every column kind the parser coerces / searches: text (default
// search + equality), numeric/int (number coercion + comparators), boolean,
// enum (raw, never coerced), timestamp (Date coercion), a custom column name,
// and a hidden ($-prefixed) column that must stay out of the default search.
@model()
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
@model()
class Tag extends Model {
  id = id()
  label = text()
}

// A model WITH a full-text index → default search routes through the tsvector.
@model({search: {columns: ['title', 'body']}})
class Doc extends Model {
  id = id()
  title = text()
  body = text()
}

const productDef = getModelDefinitionOrThrow(Product)
const tagDef = getModelDefinitionOrThrow(Tag)
const docDef = getModelDefinitionOrThrow(Doc)
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
})
