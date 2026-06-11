/**
 * Prisma-style `undefined` semantics on create: an EXPLICIT `undefined` means
 * "not provided" → the default applies, exactly as if the key were omitted. It
 * must never clobber a default. `null`, by contrast, is a real value and DOES
 * override the default (on a nullable column). Covers both default kinds:
 *  - function default (`defaultFn`, e.g. cuid)  → resolved client-side at insert
 *  - literal default (`{default: 'x'}`)         → set on construction + DB default
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  createdAt,
  createId,
  Database,
  id,
  manager,
  Model,
  model,
  setDefaultDatabase,
  signals,
  syncSchema,
  text
} from '../../src/index'

@model({table: 'dflt_widget'})
class Widget extends Model {
  static objects = manager(Widget)
  id = id()
  code = text({default: createId}) // function default → client-side defaultFn
  status = text({default: 'active'}) // literal default → NOT NULL + DB default
  label = text({nullable: true, default: 'lbl'}) // nullable WITH a default
  createdAt = createdAt() // function default (new Date)
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('explicit undefined vs default — Prisma semantics (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('dflt_widget').ifExists().cascade().execute()
    await syncSchema()
  })
  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('dflt_widget').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('omitting fields applies every default', async () => {
    const w = await Widget.objects.create({})
    expect(typeof w.code).toBe('string')
    expect(w.code.length).toBeGreaterThan(0)
    expect(w.status).toBe('active')
    expect(w.label).toBe('lbl')
    expect(w.createdAt).toBeInstanceOf(Date)
  })

  it('explicit undefined is a no-op — defaults still apply (≡ omitting)', async () => {
    const w = await Widget.objects.create({
      code: undefined,
      status: undefined,
      label: undefined,
      createdAt: undefined
    } as any)
    expect(typeof w.code).toBe('string')
    expect(w.code.length).toBeGreaterThan(0)
    expect(w.status).toBe('active')
    expect(w.label).toBe('lbl')
    expect(w.createdAt).toBeInstanceOf(Date)
  })

  it('explicit null IS a value — it overrides the default (nullable column)', async () => {
    const w = await Widget.objects.create({label: null} as any)
    expect(w.label).toBeNull() // null is assigned, NOT treated as "not provided"
    expect(w.status).toBe('active') // untouched defaults still apply
  })

  it('explicit undefined === omit, even as seen by a preSave hook (no clobber)', async () => {
    const seen: Array<string | undefined> = []
    const off = signals.preSave.connect(Widget, ({instances}) => {
      seen.push((instances[0] as any).status)
    })
    await Widget.objects.create({}) // omit
    await Widget.objects.create({status: undefined} as any) // explicit undefined
    off()
    expect(seen).toEqual(['active', 'active']) // identical pre-persist (default not clobbered)
  })

  it('a real value still overrides the default', async () => {
    const w = await Widget.objects.create({status: 'archived'} as any)
    expect(w.status).toBe('archived')
  })

  it('createMany: explicit undefined per row still applies defaults', async () => {
    const [a, b] = await Widget.objects.createMany([
      {status: undefined} as any,
      {status: 'archived'} as any
    ])
    expect(a.status).toBe('active') // default
    expect(b.status).toBe('archived') // explicit
    expect(typeof a.code).toBe('string')
  })
})
