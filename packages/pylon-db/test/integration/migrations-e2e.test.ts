/**
 * End-to-end migration check (Q2): take a model that exercises EVERY new
 * feature — enum, numeric(p,s), createdAt/updatedAt, array, m2m, full-text
 * search — generate the migration SQL the way `pylon db` does
 * (toIR → physicalSchemaOf → diffSchema → renderChanges) and EXECUTE it against
 * Postgres. Then introspect to confirm the real schema, and round-trip a row +
 * search. Proves the generated DDL actually runs, not just that it string-matches.
 */
import {
  diffSchema,
  physicalSchemaOf,
  renderChanges,
  type SchemaChange
} from '@getcronit/pylon-ir'
import {sql} from 'kysely'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  array,
  connect,
  createdAt,
  Database,
  enumOf,
  foreignKey,
  id,
  manager,
  manyToMany,
  Model,
  model,
  numeric,
  setDefaultDatabase,
  text,
  toIR,
  updatedAt
} from '../../src/index'

enum MigStatus {
  DRAFT = 'DRAFT',
  LIVE = 'LIVE'
}

@model({table: 'mig_author'})
class MigAuthor extends Model {
  static objects = manager(MigAuthor)
  id = id()
  name = text()
  posts = manyToMany(() => MigPost)
}

@model({
  table: 'mig_post',
  search: {columns: ['title', 'body'], language: 'english'},
  indexes: [{columns: ['title', 'status']}]
})
class MigPost extends Model {
  static objects = manager(MigPost)
  id = id()
  title = text()
  body = text()
  status = enumOf(MigStatus, {default: MigStatus.DRAFT})
  price = numeric({precision: 12, scale: 2})
  labels = array(text(), {nullable: true})
  createdAt = createdAt()
  updatedAt = updatedAt()
  authors = manyToMany(() => MigAuthor)
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT
const TABLES = ['mig_author_mig_post', 'mig_post', 'mig_author']

describe.skipIf(!runDb)('migration SQL executes end-to-end (Postgres)', () => {
  let db: Database
  let up: string[]

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of TABLES) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    // Generate the migration exactly as `pylon db diff` does, then run it.
    const schema = physicalSchemaOf(toIR().entities)
    const changes: SchemaChange[] = diffSchema({}, schema)
    up = renderChanges(changes).up
    for (const stmt of up) await sql.raw(stmt).execute(db.kysely)
  })

  afterAll(async () => {
    if (db) {
      for (const t of TABLES) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('generates a non-trivial migration (createTable/FK/index ops)', () => {
    expect(up.length).toBeGreaterThan(3)
  })

  it('applied: numeric(p,s), enum CHECK, array, generated tsvector all exist', async () => {
    const cols = await sql<{
      column_name: string
      data_type: string
      numeric_precision: number | null
      numeric_scale: number | null
      is_generated: string
    }>`
      SELECT column_name, data_type, numeric_precision, numeric_scale, is_generated
      FROM information_schema.columns
      WHERE table_name = 'mig_post'
    `.execute(db.kysely)
    const by = Object.fromEntries(cols.rows.map(c => [c.column_name, c]))
    expect(Number(by.price.numeric_precision)).toBe(12)
    expect(Number(by.price.numeric_scale)).toBe(2)
    expect(by.labels.data_type).toBe('ARRAY')
    expect(by.fts.data_type).toBe('tsvector')
    expect(by.fts.is_generated).toBe('ALWAYS') // STORED generated column

    // enum CHECK constraint exists on status
    const checks = await sql<{check_clause: string}>`
      SELECT cc.check_clause
      FROM information_schema.check_constraints cc
      JOIN information_schema.constraint_column_usage ccu
        ON cc.constraint_name = ccu.constraint_name
      WHERE ccu.table_name = 'mig_post' AND ccu.column_name = 'status'
    `.execute(db.kysely)
    expect(checks.rows.some(r => /DRAFT|LIVE/.test(r.check_clause))).toBe(true)
  })

  it('applied: the GIN index + composite index + m2m join table exist', async () => {
    const idx = await sql<{indexname: string; indexdef: string}>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'mig_post'
    `.execute(db.kysely)
    expect(idx.rows.some(r => /USING gin/.test(r.indexdef))).toBe(true)
    expect(idx.rows.some(r => /\(title, status\)/.test(r.indexdef))).toBe(true)

    const join = await db.kysely.introspection.getTables()
    expect(join.map(t => t.name)).toContain('mig_author_mig_post')
  })

  it('round-trips a row + full-text search against the migrated schema', async () => {
    const author = await MigAuthor.objects.create({name: 'Ada'})
    const post = await MigPost.objects.create({
      title: 'Quick brown fox',
      body: 'jumps over the lazy dog',
      status: MigStatus.LIVE,
      price: 9.99
    })
    await post.authors.add(author)

    expect(Number((post as any).price)).toBeCloseTo(9.99, 2)
    expect((post as any).status).toBe('LIVE')
    expect((post as any).createdAt).toBeInstanceOf(Date)

    const hits = await MigPost.objects.search('fox').all()
    expect(hits.map(p => p.title)).toEqual(['Quick brown fox'])
    expect((await author.posts.all()).map(p => p.title)).toEqual(['Quick brown fox'])
  })
})
