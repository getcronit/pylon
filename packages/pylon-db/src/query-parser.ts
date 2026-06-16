// Shopify-style search-query DSL → `WhereInput`.
//
// A paginated connection / query exposes a single `query: String` arg (a scalar —
// no per-model GraphQL input type to generate, which is what makes this tractable
// where a typed `WhereInput<R>` is not). The string is parsed HERE, against the
// target model's column metadata (field validation + value coercion), into the
// ORM's `WhereInput` so it composes with the relation/query scoping.
//
// Implements the Shopify Admin API search syntax
// (https://shopify.dev/docs/api/usage/search-syntax):
//
//   field:value                 equality, coerced to the column type
//   field:>v  >=  <  <=         comparators (numbers / dates)
//   field:val*                  prefix match (startsWith, case-insensitive)
//   field:*                     EXISTS — the column is non-null
//   value      /   val*         default search: contains / startsWith over the
//                               model's text columns (case-insensitive)
//   "a phrase"                  quotes group a value/term verbatim (specials literal)
//   -term   |  NOT term         negation
//   a OR b   /   a b  /  a AND b  connectives — implicit AND; OR binds TIGHTER than
//                               AND (Shopify precedence), so `a OR b AND c` =
//                               `(a OR b) AND c`
//   (a OR b) c                  grouping
//   \: \\ \( \) \*              backslash-escape a special character
//
// Unknown fields are skipped (lenient, like Shopify) so a frontend typo degrades
// to "no constraint", never a 500. Pure — no DB access.

import type {ModelDefinition} from './registry.js'
import {
  buildQuerySchema,
  publicFieldNames,
  type QueryableField,
  type QueryScope,
  type QuerySchema
} from './query-schema.js'

type Where = Record<string, unknown>

/** Thrown when a query parsed in the `public` scope references an unknown or
 *  non-queryable (internal/hidden) field. Internally, unknown fields are lenient. */
export class QueryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryParseError'
  }
}

// ── Tokenizer ────────────────────────────────────────────────────────────────
// Splits on UNESCAPED, UNQUOTED whitespace / parens. `AND`/`OR`/`NOT` (any case)
// are connectives; everything else is a `term` whose RAW text keeps its
// backslash escapes and quotes for the atom parser to interpret.
interface Token {
  kind: 'lparen' | 'rparen' | 'and' | 'or' | 'not' | 'term'
  raw: string
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    const c = input[i]
    if (isSpace(c)) {
      i++
      continue
    }
    if (c === '(') {
      tokens.push({kind: 'lparen', raw: '('})
      i++
      continue
    }
    if (c === ')') {
      tokens.push({kind: 'rparen', raw: ')'})
      i++
      continue
    }
    // Accumulate a term up to the next unescaped/unquoted whitespace or paren.
    let raw = ''
    while (i < n) {
      const ch = input[i]
      if (ch === '\\' && i + 1 < n) {
        raw += ch + input[i + 1] // keep the escape for the atom parser
        i += 2
        continue
      }
      if (ch === '"') {
        // Quoted span — copy verbatim (incl. the quotes) so the atom parser
        // treats its contents as literal (no field split, no wildcard).
        raw += ch
        i++
        while (i < n && input[i] !== '"') {
          if (input[i] === '\\' && i + 1 < n) {
            raw += input[i] + input[i + 1]
            i += 2
          } else {
            raw += input[i]
            i++
          }
        }
        if (i < n) {
          raw += '"'
          i++
        }
        continue
      }
      if (isSpace(ch) || ch === '(' || ch === ')') break
      raw += ch
      i++
    }
    if (raw === '') continue
    const upper = raw.toUpperCase()
    if (upper === 'AND') tokens.push({kind: 'and', raw})
    else if (upper === 'OR') tokens.push({kind: 'or', raw})
    else if (upper === 'NOT') tokens.push({kind: 'not', raw})
    else tokens.push({kind: 'term', raw})
  }
  return tokens
}

// ── Raw-atom helpers (escape + quote aware) ──────────────────────────────────
/** First index of `target` that is neither backslash-escaped nor inside quotes. */
function indexOfUnescapedUnquoted(s: string, target: string): number {
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && c === target) return i
  }
  return -1
}

/** Resolve escapes + strip quotes → the literal string. */
function unescape(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      out += s[i + 1]
      i++
    } else if (c === '"') {
      // drop quote delimiters
    } else {
      out += c
    }
  }
  return out
}

/** A bare `*` (single, unescaped, unquoted asterisk) — the EXISTS sentinel. */
function isBareStar(s: string): boolean {
  return s === '*'
}

/** Strip a trailing UNESCAPED, UNQUOTED `*` (prefix wildcard); returns the
 *  unescaped literal + whether a wildcard was present. */
function literalWithWildcard(s: string): {value: string; prefix: boolean} {
  // Is the final char an unescaped, unquoted '*'?
  let quoted = false
  let lastWasEscaped = false
  let endsWithStar = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      i++
      lastWasEscaped = i === s.length - 1
      endsWithStar = false
      continue
    }
    lastWasEscaped = false
    if (c === '"') {
      quoted = !quoted
      endsWithStar = false
      continue
    }
    endsWithStar = !quoted && c === '*'
  }
  if (endsWithStar && !lastWasEscaped) {
    return {value: unescape(s.slice(0, s.lastIndexOf('*'))), prefix: true}
  }
  return {value: unescape(s), prefix: false}
}

/** Split a (possibly dotted) field name into path segments on UNESCAPED dots,
 *  then unescape each — `vendor.name` → `['vendor', 'name']`, `a\.b` → `['a.b']`. */
function splitPath(raw: string): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === '\\' && i + 1 < raw.length) {
      cur += c + raw[i + 1]
      i++
      continue
    }
    if (c === '.') {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  parts.push(cur)
  return parts.map(unescape)
}

/** Public-scope guard: cap the number of leaf predicates (boolean nodes) so a
 *  hostile query can't blow up the WHERE tree. Generous; internal scope is unbound. */
const DEFAULT_MAX_BOOLEAN_NODES = 100

const OP_PREFIX: Array<{token: string; key: string}> = [
  {token: '>=', key: 'gte'},
  {token: '<=', key: 'lte'},
  {token: '>', key: 'gt'},
  {token: '<', key: 'lt'}
]

// ── Parser (recursive descent) ───────────────────────────────────────────────
class Parser {
  private pos = 0
  private nodeCount = 0
  constructor(
    private readonly tokens: Token[],
    private readonly schema: QuerySchema,
    private readonly scope: QueryScope,
    private readonly maxBooleanNodes: number
  ) {}

  parse(): Where {
    if (this.tokens.length === 0) return {}
    return this.parseAnd()
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++]
  }

  // AND is the LOOSEST level (Shopify: OR binds tighter than AND). Implicit AND
  // between adjacent terms; explicit `AND` is consumed.
  private parseAnd(): Where {
    const parts: Where[] = [this.parseOr()]
    for (;;) {
      const t = this.peek()
      if (!t || t.kind === 'rparen') break
      if (t.kind === 'and') {
        this.next()
        parts.push(this.parseOr())
        continue
      }
      if (t.kind === 'or') break // safety — parseOr already consumed OR chains
      // implicit AND: another term/group/NOT follows
      parts.push(this.parseOr())
    }
    return merge('AND', parts)
  }

  private parseOr(): Where {
    const parts: Where[] = [this.parseTerm()]
    while (this.peek()?.kind === 'or') {
      this.next()
      parts.push(this.parseTerm())
    }
    return merge('OR', parts)
  }

  private parseTerm(): Where {
    const t = this.peek()
    if (!t) return {}
    if (t.kind === 'lparen') {
      this.next()
      const inner = this.parseAnd()
      if (this.peek()?.kind === 'rparen') this.next()
      return inner
    }
    if (t.kind === 'not') {
      this.next()
      const inner = this.parseTerm()
      return Object.keys(inner).length ? {NOT: [inner]} : {}
    }
    // a stray AND/OR in term position → treat as nothing
    if (t.kind === 'and' || t.kind === 'or') {
      this.next()
      return {}
    }
    this.next()
    return this.atom(t.raw)
  }

  // `[-][field:]value` → a WhereInput fragment.
  private atom(raw: string): Where {
    if (this.scope === 'public' && ++this.nodeCount > this.maxBooleanNodes) {
      throw new QueryParseError(`Query too complex: more than ${this.maxBooleanNodes} terms.`)
    }
    let negated = false
    if (raw.startsWith('-') && raw.length > 1) {
      negated = true
      raw = raw.slice(1)
    }
    const colon = indexOfUnescapedUnquoted(raw, ':')
    const where = colon === -1 ? this.bareTerm(raw) : this.fieldTerm(raw, colon)
    if (!Object.keys(where).length) return {}
    return negated ? {NOT: [where]} : where
  }

  // Default search. Routes through the model's GIN-indexed `tsvector` (the
  // `@model({search})` column) for performance — a `{search}` predicate the
  // WhereInput compiler turns into `@@ websearch_to_tsquery` (or a prefix
  // `to_tsquery(... :*)` for a trailing wildcard). Models WITHOUT a search column
  // fall back to (un-indexed) substring `contains` over their text columns.
  private bareTerm(raw: string): Where {
    if (isBareStar(raw)) return {} // a lone `*` constrains nothing
    const {value, prefix} = literalWithWildcard(raw)
    if (!value) return {}
    const {fts, textColumns} = this.schema.search
    if (fts) {
      return {[fts.propertyKey]: prefix ? {search: value, prefix: true} : {search: value}}
    }
    if (textColumns.length === 0) return {}
    const op = prefix ? 'startsWith' : 'contains'
    const ors = textColumns.map(pk => ({[pk]: {[op]: value, mode: 'insensitive'}}))
    return ors.length === 1 ? ors[0] : {OR: ors}
  }

  private fieldTerm(raw: string, colon: number): Where {
    const rawName = raw.slice(0, colon)
    const rawValue = raw.slice(colon + 1)
    const resolved = this.resolvePath(rawName)
    if (!resolved) return {} // unknown field → no constraint (lenient; strict already threw)
    return resolved.wrap(this.leafPredicate(resolved.field, rawValue))
  }

  /** Resolve a (possibly dotted) field path against the schema, walking relations
   *  (`vendor.name`, `inventoryItems.sku`). Returns the leaf scalar field plus a
   *  `wrap` that nests a leaf predicate back through the relation path (`{some:…}`
   *  for a to-many hop). Honors visibility/scope: a `public` query for an unknown
   *  or internal field/relation is a hard error; internally it's dropped (lenient).
   *  Depth is bounded by the schema (relations beyond the budget aren't present). */
  private resolvePath(rawName: string): {field: QueryableField; wrap: (p: Where) => Where} | undefined {
    const segments = splitPath(rawName)
    let schema = this.schema
    const wrappers: Array<(p: Where) => Where> = []
    for (let i = 0; i < segments.length - 1; i++) {
      const rel = schema.relations.get(segments[i])
      if (!rel || (this.scope === 'public' && rel.visibility !== 'public')) {
        return this.rejectField(rawName)
      }
      const prop = rel.propertyKey
      const toMany = rel.toMany
      wrappers.push(p => ({[prop]: toMany ? {some: p} : p}))
      schema = rel.target()
    }
    const field = schema.byName.get(segments[segments.length - 1])
    if (!field || (this.scope === 'public' && field.visibility !== 'public')) {
      return this.rejectField(rawName)
    }
    // Nest innermost-first: the leaf predicate is wrapped by the deepest relation,
    // then outward — `a.b.c` → `{a: {b: {c: pred}}}` (with `some` per to-many hop).
    const wrap = (p: Where) => wrappers.reduceRight((acc, w) => w(acc), p)
    return {field, wrap}
  }

  /** Unknown/non-queryable field: throw in `public` scope, lenient-drop internally. */
  private rejectField(name: string): undefined {
    if (this.scope === 'public') {
      throw new QueryParseError(
        `Unknown or non-queryable field "${name}". Queryable fields: ${publicFieldNames(this.schema).join(', ')}.`
      )
    }
    return undefined
  }

  /** Build the scalar leaf predicate `{field: …}` from a field + its raw value. */
  private leafPredicate(field: QueryableField, rawValue: string): Where {
    // EXISTS — `field:*`
    if (isBareStar(rawValue)) return {[field.propertyKey]: {not: null}}

    // Comparators — `field:>=v`
    const op = OP_PREFIX.find(o => rawValue.startsWith(o.token))
    if (op) {
      return {[field.propertyKey]: {[op.key]: this.coerce(field, unescape(rawValue.slice(op.token.length)))}}
    }

    // Prefix wildcard — `field:val*` (text columns only)
    const {value, prefix} = literalWithWildcard(rawValue)
    if (prefix && field.textual) {
      return {[field.propertyKey]: {startsWith: value, mode: 'insensitive'}}
    }

    // Plain equality
    return {[field.propertyKey]: this.coerce(field, value)}
  }

  // Coerce a raw string to the field's runtime type. Enum membership is left to
  // the DB (a bad value simply matches nothing).
  private coerce(field: QueryableField, raw: string): unknown {
    if (field.enumValues && field.enumValues.length) return raw
    const t = field.sqlType
    if (t === 'boolean') return raw === 'true' || raw === '1'
    if (t === 'integer' || t === 'bigint' || t === 'numeric') {
      const num = Number(raw)
      return Number.isNaN(num) ? raw : num
    }
    if (t === 'date' || t === 'timestamptz') {
      const d = new Date(raw)
      return Number.isNaN(d.getTime()) ? raw : d
    }
    return raw
  }
}

function merge(kind: 'AND' | 'OR', parts: Where[]): Where {
  const real = parts.filter(p => Object.keys(p).length)
  if (real.length === 0) return {}
  if (real.length === 1) return real[0]
  return {[kind]: real}
}

/**
 * Parse a Shopify-style search-query string into a `WhereInput` for `def`. Returns
 * `{}` for an empty/whitespace query (no constraint).
 */
export function parseSearchQuery(
  input: string,
  def: ModelDefinition,
  opts: {scope?: QueryScope; maxRelationDepth?: number; maxBooleanNodes?: number} = {}
): Where {
  if (!input || !input.trim()) return {}
  const schema = buildQuerySchema(def, opts.maxRelationDepth)
  return new Parser(
    tokenize(input.trim()),
    schema,
    opts.scope ?? 'internal',
    opts.maxBooleanNodes ?? DEFAULT_MAX_BOOLEAN_NODES
  ).parse()
}
