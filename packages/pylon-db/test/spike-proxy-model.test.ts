/**
 * P0 SPIKE — Proxy-returning `Model` base (decision gate for dd/MODEL_QUEUE_REGISTRATION.md §6/§9).
 *
 * Proves the risky mechanism in isolation, faithful to pylon-db's real shapes
 * (FieldBuilder/RelationBuilder, a column registry, columnName=snake(propertyKey),
 * ctor-skipping hydrate) WITHOUT touching the shipped decorator path. The question
 * this answers: can a plain `class Post extends Model { id = id() }` — no decorator —
 * be registered externally (`app.model(Post)`) and behave correctly?
 *
 * Mechanism: `Model`'s constructor `return new Proxy(this, handler)`. A derived ctor
 * adopts super()'s object return, so subclass field initializers (`id = id()`) run
 * AS [[DefineOwnProperty]] ON THE PROXY → hit a `defineProperty` trap that swallows the
 * builder and routes it to schema + store. No own prop materializes → nothing shadows,
 * no `Wrapped` subclass, no binding replacement, no decorator.
 */
import {describe, it, expect} from 'vitest'

// ── Builders (mirror pylon-db FieldBuilder / RelationBuilder) ────────────────
class FieldBuilder {
  constructor(
    readonly sqlType: string,
    readonly options: {primaryKey?: boolean; autoIncrement?: boolean; default?: unknown; min?: number} = {}
  ) {}
}
class RelationBuilder {
  constructor(
    readonly kind: 'belongsTo' | 'hasMany',
    readonly target: () => Function,
    readonly options: {foreignKey?: string} = {}
  ) {}
}
// Public field factories — typed as the column's value type, like the real API.
const id = () => new FieldBuilder('bigint', {primaryKey: true, autoIncrement: true}) as unknown as number
const text = (o: {min?: number; default?: string} = {}) => new FieldBuilder('text', o) as unknown as string
const foreignKey = (target: () => Function) => new RelationBuilder('belongsTo', target) as unknown as number
const hasMany = (target: () => Function, o: {foreignKey?: string} = {}) =>
  new RelationBuilder('hasMany', target, o) as unknown as any
type Relation<T> = Promise<T | null>

// ── Registry ─────────────────────────────────────────────────────────────────
interface ColumnDef {propertyKey: string; columnName: string; sqlType: string; primaryKey: boolean}
interface RelationDef {kind: 'belongsTo' | 'hasMany'; propertyKey: string; target: () => Function; fkProperty?: string; foreignKey?: string}
interface ModelDef {ctor: Function; table: string; app?: string; columns: ColumnDef[]; relations: RelationDef[]}
const registry = new Map<Function, ModelDef>()
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
function defOf(ctor: Function): ModelDef {
  let d = registry.get(ctor)
  if (!d) {
    d = {ctor, table: snake(ctor.name), columns: [], relations: []}
    registry.set(ctor, d)
  }
  return d
}
const colOf = (ctor: Function, k: PropertyKey) =>
  typeof k === 'string' ? registry.get(ctor)?.columns.find(c => c.propertyKey === k) : undefined
const isColumn = (ctor: Function, k: PropertyKey) => !!colOf(ctor, k)
const isRelation = (ctor: Function, k: PropertyKey) =>
  typeof k === 'string' && !!registry.get(ctor)?.relations.some(r => r.propertyKey === k)
const columnNames = (ctor: Function) => registry.get(ctor)?.columns.map(c => c.propertyKey) ?? []

// ── Proxy machinery ──────────────────────────────────────────────────────────
const STORE = Symbol('pylon.columns')
function store(t: any): Record<string, unknown> {
  let s = t[STORE]
  if (!s) {
    s = {}
    Object.defineProperty(t, STORE, {value: s, enumerable: false, configurable: true})
  }
  return s
}

let trapGets = 0 // benchmark instrumentation

// Swallow a field-initializer builder → harvest schema (idempotent) + seed defaults.
// MUST run in BOTH `set` and `defineProperty`: class fields may compile to assignment
// (useDefineForClassFields=false) OR define, AND it must take PRECEDENCE over the
// is-column store-write — otherwise, once a column is harvested, a later `this.id =
// builder` initializer would store the BUILDER as the column value. Returns true if
// the value was a builder (caller should swallow), false otherwise.
function captureBuilder(t: any, k: PropertyKey, v: unknown): boolean {
  const ctor = t.constructor
  if (v instanceof FieldBuilder) {
    const d = defOf(ctor)
    if (!d.columns.some(c => c.propertyKey === k))
      d.columns.push({propertyKey: k as string, columnName: snake(k as string), sqlType: v.sqlType, primaryKey: !!v.options.primaryKey})
    if ('default' in v.options) store(t)[k as string] = v.options.default
    return true
  }
  if (v instanceof RelationBuilder) {
    const d = defOf(ctor)
    if (v.kind === 'belongsTo') {
      const fk = k as string // the FK is also a scalar column (filterable, hydrated)
      if (!d.columns.some(c => c.propertyKey === fk))
        d.columns.push({propertyKey: fk, columnName: snake(fk), sqlType: 'bigint', primaryKey: false})
      const accessor = fk.endsWith('Id') ? fk.slice(0, -2) : `${fk}Ref`
      if (!d.relations.some(r => r.propertyKey === accessor))
        d.relations.push({kind: 'belongsTo', propertyKey: accessor, target: v.target, fkProperty: fk})
    } else if (!d.relations.some(r => r.propertyKey === k)) {
      d.relations.push({kind: 'hasMany', propertyKey: k as string, target: v.target, foreignKey: v.options.foreignKey})
    }
    return true
  }
  return false
}

const handler: ProxyHandler<any> = {
  defineProperty(t, k, desc) {
    if (captureBuilder(t, k, (desc as PropertyDescriptor).value)) return true
    return Reflect.defineProperty(t, k, desc)
  },
  get(t, k, r) {
    const ctor = t.constructor
    if (isColumn(ctor, k)) {
      trapGets++
      return store(t)[k as string]
    }
    if (isRelation(ctor, k)) return loadRelation(t, ctor, k as string)
    return Reflect.get(t, k, r) // methods ($save, greet), symbols, constructor
  },
  set(t, k, v, r) {
    if (captureBuilder(t, k, v)) return true // builder swallow takes precedence
    if (isColumn(t.constructor, k)) {
      if (v !== undefined) store(t)[k as string] = v // ignore undefined (Prisma "not provided")
      return true
    }
    return Reflect.set(t, k, v, r)
  },
  has(t, k) {
    return isColumn(t.constructor, k) || isRelation(t.constructor, k) || Reflect.has(t, k)
  },
  // Columns surface as enumerable own props → Object.keys / spread / JSON see VALUES.
  ownKeys(t) {
    const cols = columnNames(t.constructor)
    const real = Reflect.ownKeys(t).filter(x => typeof x === 'string' && !cols.includes(x))
    return [...cols, ...real]
  },
  getOwnPropertyDescriptor(t, k) {
    if (isColumn(t.constructor, k))
      return {value: store(t)[k as string], writable: true, enumerable: true, configurable: true}
    return Reflect.getOwnPropertyDescriptor(t, k)
  },
  deleteProperty(t, k) {
    if (isColumn(t.constructor, k)) {
      delete store(t)[k as string]
      return true
    }
    return Reflect.deleteProperty(t, k)
  }
}

class Model {
  constructor() {
    return new Proxy(this, handler) // derived `this` becomes this proxy
  }
}

// ── Tiny in-memory "DB" + manager-lite (rows keyed by columnName, like SQL) ──
const TABLES = new Map<Function, any[]>()

// Hot-path hydration: skip the ctor (no field-initializer builder churn), seed store.
function hydrate(ctor: any, row: any): any {
  const t = Object.create(ctor.prototype)
  const s = store(t)
  for (const c of defOf(ctor).columns) if (c.columnName in row) s[c.propertyKey] = row[c.columnName]
  return new Proxy(t, handler)
}
function loadRelation(t: any, ctor: Function, key: string): Promise<any> {
  const rel = defOf(ctor).relations.find(r => r.propertyKey === key)!
  const target = rel.target()
  const rows = TABLES.get(target) ?? []
  if (rel.kind === 'belongsTo') {
    const fk = store(t)[rel.fkProperty!]
    if (fk == null) return Promise.resolve(null)
    const row = rows.find(r => r.id === fk)
    return Promise.resolve(row ? hydrate(target, row) : null)
  }
  const myId = store(t)['id']
  const fkCol = snake(rel.foreignKey ?? 'authorId')
  return Promise.resolve(rows.filter(r => r[fkCol] === myId).map(r => hydrate(target, r)))
}
const manager = (getCtor: () => any) => ({
  all: () => (TABLES.get(getCtor()) ?? []).map(r => hydrate(getCtor(), r)),
  get: (where: {id: number}) => {
    const row = (TABLES.get(getCtor()) ?? []).find(r => r.id === where.id)
    return row ? hydrate(getCtor(), row) : null
  }
})

// ── The app + registration seam (no decorator) ──────────────────────────────
class Pylon {
  readonly name: string
  readonly models: Function[] = []
  constructor(opts: {name: string}) {
    this.name = opts.name
  }
  model(...ctors: Function[]) {
    for (const C of ctors) {
      new (C as any)() // probe → defineProperty traps harvest the schema
      const d = defOf(C)
      d.app = this.name
      d.table = `${this.name}_${snake(C.name)}` // app-binding patch: re-prefix
      this.models.push(C)
    }
    return this
  }
}

// ── The user's snippet: plain classes, no decorator, no app import ──────────
class Author extends Model {
  static objects = manager(() => Author)
  id = id()
  name = text({min: 2})
  books = hasMany(() => Book, {foreignKey: 'authorId'})
  greet() {
    return `I am ${(this as any).name}` // this === proxy → routes through store
  }
}
class Book extends Model {
  static objects = manager(() => Book)
  id = id()
  title = text()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
}

const blog = new Pylon({name: 'blog'})
blog.model(Author, Book)

TABLES.set(Author, [{id: 1, name: 'Ada'}])
TABLES.set(Book, [
  {id: 10, title: 'Analytical Engine', author_id: 1},
  {id: 11, title: 'Notes', author_id: 1}
])

// ─────────────────────────────────────────────────────────────────────────────
describe('P0 spike: Proxy-returning Model base', () => {
  it('registers externally — app.models populated, table re-prefixed, no decorator', () => {
    expect(blog.models).toEqual([Author, Book])
    expect(defOf(Author).table).toBe('blog_author')
    expect(defOf(Book).table).toBe('blog_book')
  })

  it('harvests columns + relations from `id = id()` initializers', () => {
    expect(columnNames(Author).sort()).toEqual(['id', 'name'])
    // belongsTo registers BOTH the FK scalar column and the `author` accessor.
    expect(columnNames(Book).sort()).toEqual(['authorId', 'id', 'title'])
    expect(isRelation(Author, 'books')).toBe(true)
    expect(isRelation(Book, 'author')).toBe(true)
  })

  it('`id = id()` works: reads return column values, not the builder', () => {
    const a: any = new Author()
    expect(a.id).toBeUndefined() // unset
    a.name = 'Grace'
    expect(a.name).toBe('Grace') // routed through the store, not a FieldBuilder
    expect(a.name).not.toBeInstanceOf(FieldBuilder)
    a.name = undefined // "not provided" → no-op
    expect(a.name).toBe('Grace')
  })

  it('methods keep `this` === proxy (column access inside a method works)', () => {
    const a: any = new Author()
    a.name = 'Ada'
    expect(a.greet()).toBe('I am Ada')
  })

  it('serializes cleanly: Object.keys / spread / JSON show values, hide the store', () => {
    const b: any = hydrate(Book, {id: 10, title: 'Analytical Engine', author_id: 1})
    expect(Object.keys(b).sort()).toEqual(['authorId', 'id', 'title'])
    expect({...b}).toEqual({id: 10, title: 'Analytical Engine', authorId: 1})
    expect(JSON.parse(JSON.stringify(b))).toEqual({id: 10, title: 'Analytical Engine', authorId: 1})
    expect(Object.getOwnPropertySymbols(b)).toHaveLength(0) // STORE never leaks
    expect('title' in b).toBe(true)
    delete b.title
    expect(b.title).toBeUndefined()
  })

  it('relations resolve (belongsTo + hasMany) via the get trap', async () => {
    const book: any = Book.objects.get({id: 10})
    const author = await book.author
    expect(author.name).toBe('Ada')

    const ada: any = Author.objects.get({id: 1})
    const books = await ada.books
    expect(books.map((x: any) => x.title).sort()).toEqual(['Analytical Engine', 'Notes'])
  })

  it('manager.all hydrates without running field initializers', () => {
    const all = Author.objects.all()
    expect(all.map((a: any) => a.name)).toEqual(['Ada'])
  })

  it('DOCUMENTS THE #private HAZARD: a base-class private is unreachable via the proxy', () => {
    // A private added while `this` is the raw target (before the proxy is returned)
    // cannot be read once `this` is the proxy. This is why Model + models must keep
    // state in a Symbol (the COLUMN_STORE pattern), never `#private`.
    class Base {
      #secret = 42
      constructor() {
        return new Proxy(this, {})
      }
      read() {
        return this.#secret // this === proxy → PrivateFieldGet fails
      }
    }
    const b = new Base()
    expect(() => b.read()).toThrow(TypeError)
  })

  it('BENCHMARK: proxy vs plain-object field reads (informs perf gate, not asserted hard)', () => {
    const N = 10_000
    const rows = Array.from({length: N}, (_, i) => ({id: i, title: `t${i}`, author_id: 1}))

    trapGets = 0
    const tProxyStart = performance.now()
    let sink = 0
    const proxies = rows.map(r => hydrate(Book, r))
    for (const p of proxies as any[]) sink += (p.id as number) + (p.title as string).length + (p.authorId as number)
    const proxyMs = performance.now() - tProxyStart

    const plain = rows.map(r => ({id: r.id, title: r.title, authorId: r.author_id}))
    const tPlainStart = performance.now()
    let sink2 = 0
    for (const p of plain) sink2 += p.id + p.title.length + p.authorId
    const plainMs = performance.now() - tPlainStart

    // eslint-disable-next-line no-console
    console.log(
      `\n[P0 BENCH] ${N} rows × 3 reads — proxy ${proxyMs.toFixed(1)}ms vs plain ${plainMs.toFixed(1)}ms ` +
        `(${(proxyMs / Math.max(plainMs, 0.01)).toFixed(1)}× ; ${trapGets} trap gets)\n`
    )
    expect(sink).toBeGreaterThan(0)
    expect(sink2).toBeGreaterThan(0)
    // Loose absolute ceiling only (ratio is for the human decision, not CI flake).
    expect(proxyMs).toBeLessThan(500)
  })
})
