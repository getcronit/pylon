/**
 * Typed, Prisma-style filtering (`WhereInput`) against a real Postgres:
 * per-field operators, AND/OR/NOT, nullable handling, array operators, and
 * case-insensitive string matching. Also asserts FTS `.search()` composes with
 * `.filter()` (both AND into one WHERE).
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  array,
  boolean,
  connect,
  Database,
  enumOf,
  id,
  int,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text,
  timestamp,
  type WhereInput
} from '@/db/index'

enum Plan {
  FREE = 'FREE',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE'
}

class Widget extends Model {
  static config = {table: 'flt_widget', search: {columns: ['name']}} satisfies ModelConfig<Widget>
  static objects = manager(Widget)
  id = id()
  name = text()
  note = text({nullable: true})
  qty = int()
  active = boolean()
  plan = enumOf(Plan)
  tags = array(text())
  createdAt = timestamp()

  label(): string {
    return this.name.toUpperCase()
  }
}
new Pylon({db: {models: [Widget]}})

// ── Compile-time contract (no runtime effect) ───────────────────────────────
// Each @ts-expect-error must fire — tsc reports an *unused* directive otherwise,
// which fails the typecheck, so these double as type-level assertions.
{
  const valid: WhereInput<Widget> = {
    qty: {gt: 1, lte: 10},
    name: {contains: 'x', mode: 'insensitive'},
    tags: {has: 'red'},
    plan: {in: [Plan.PRO]},
    note: null,
    OR: [{active: true}, {qty: {gte: 5}}],
    NOT: {name: 'x'}
  }
  void valid

  // @ts-expect-error — computed methods are not filterable
  const m: WhereInput<Widget> = {label: 'x'}
  void m

  // @ts-expect-error — string operators don't apply to a number field
  const n: WhereInput<Widget> = {qty: {contains: '5'}}
  void n

  // @ts-expect-error — wrong value type for the equality shorthand
  const w: WhereInput<Widget> = {qty: 'not-a-number'}
  void w

  // @ts-expect-error — unknown field
  const u: WhereInput<Widget> = {nope: 1}
  void u
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

const d = (s: string) => new Date(s)

describe.skipIf(!runDb)('typed filtering — WhereInput (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('flt_widget').ifExists().cascade().execute()
    await syncSchema()
    await Widget.objects.createMany([
      {name: 'Alpha', note: 'first', qty: 5, active: true, plan: Plan.FREE, tags: ['red', 'blue'], createdAt: d('2026-01-01')},
      {name: 'Beta', note: null, qty: 10, active: true, plan: Plan.PRO, tags: ['blue'], createdAt: d('2026-02-01')},
      {name: 'Gamma', note: 'third', qty: 20, active: false, plan: Plan.PRO, tags: ['green'], createdAt: d('2026-03-01')},
      {name: 'Delta', note: null, qty: 30, active: false, plan: Plan.ENTERPRISE, tags: [], createdAt: d('2026-04-01')}
    ])
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('flt_widget').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  const names = async (where: WhereInput<Widget>) =>
    (await Widget.objects.filter(where).orderBy('name').all()).map(w => w.name)

  it('shorthand equality still works (backward compatible)', async () => {
    expect(await names({name: 'Alpha'})).toEqual(['Alpha'])
    expect(await names({active: true})).toEqual(['Alpha', 'Beta'])
  })

  it('numeric comparisons: lt/lte/gt/gte', async () => {
    expect(await names({qty: {gt: 10}})).toEqual(['Delta', 'Gamma'])
    expect(await names({qty: {gte: 10}})).toEqual(['Beta', 'Delta', 'Gamma'])
    expect(await names({qty: {lt: 10}})).toEqual(['Alpha'])
    expect(await names({qty: {gte: 10, lte: 20}})).toEqual(['Beta', 'Gamma'])
  })

  it('in / notIn / not', async () => {
    expect(await names({plan: {in: [Plan.PRO, Plan.ENTERPRISE]}})).toEqual(['Beta', 'Delta', 'Gamma'])
    expect(await names({plan: {notIn: [Plan.PRO]}})).toEqual(['Alpha', 'Delta'])
    expect(await names({name: {not: 'Alpha'}})).toEqual(['Beta', 'Delta', 'Gamma'])
    expect(await names({qty: {in: []}})).toEqual([]) // empty IN → matches nothing
  })

  it('string contains / startsWith / endsWith (+ insensitive mode)', async () => {
    expect(await names({name: {startsWith: 'Al'}})).toEqual(['Alpha'])
    expect(await names({name: {endsWith: 'a'}})).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma'])
    expect(await names({name: {contains: 'amm'}})).toEqual(['Gamma'])
    // case-insensitive
    expect(await names({name: {contains: 'ALPH', mode: 'insensitive'}})).toEqual(['Alpha'])
    // default is case-sensitive
    expect(await names({name: {contains: 'ALPH'}})).toEqual([])
    // metacharacters are escaped, not treated as wildcards
    expect(await names({name: {contains: '%'}})).toEqual([])
  })

  it('nullable: equals null / not null', async () => {
    expect(await names({note: {equals: null}})).toEqual(['Beta', 'Delta'])
    expect(await names({note: {not: null}})).toEqual(['Alpha', 'Gamma'])
    expect(await names({note: null})).toEqual(['Beta', 'Delta']) // shorthand null
  })

  it('AND / OR / NOT combinators', async () => {
    expect(await names({AND: [{active: false}, {qty: {gt: 20}}]})).toEqual(['Delta'])
    expect(await names({OR: [{name: 'Alpha'}, {qty: {gte: 30}}]})).toEqual(['Alpha', 'Delta'])
    expect(await names({NOT: {active: true}})).toEqual(['Delta', 'Gamma'])
    // nested: active OR (plan=PRO AND qty<15)
    expect(await names({OR: [{active: true}, {AND: [{plan: Plan.PRO}, {qty: {lt: 15}}]}]})).toEqual([
      'Alpha',
      'Beta'
    ])
  })

  it('Date comparisons', async () => {
    expect(await names({createdAt: {gte: d('2026-03-01')}})).toEqual(['Delta', 'Gamma'])
  })

  it('array operators: has / hasSome / hasEvery / isEmpty', async () => {
    expect(await names({tags: {has: 'blue'}})).toEqual(['Alpha', 'Beta'])
    expect(await names({tags: {hasSome: ['green', 'red']}})).toEqual(['Alpha', 'Gamma'])
    expect(await names({tags: {hasEvery: ['red', 'blue']}})).toEqual(['Alpha'])
    expect(await names({tags: {isEmpty: true}})).toEqual(['Delta'])
    expect(await names({tags: {isEmpty: false}})).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('rejects an unknown operator with a clear error', async () => {
    await expect(
      Widget.objects.filter({qty: {between: 1} as any}).all()
    ).rejects.toThrow(/Unknown filter operator "between"/)
  })

  it('FTS .search() composes with .filter() (both AND into one WHERE)', async () => {
    // search matches Alpha + Beta (websearch OR); filter narrows to PRO → Beta.
    const rows = await Widget.objects
      .search('Alpha OR Beta')
      .filter({plan: Plan.PRO})
      .all()
    expect(rows.map(w => w.name)).toEqual(['Beta'])
  })

  it('.search({rank}) orders by relevance', async () => {
    const rows = await Widget.objects.search('Gamma', {rank: true}).all()
    expect(rows[0]?.name).toBe('Gamma')
  })
})
