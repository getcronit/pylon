/**
 * Deep introspection (`introspectPhysical`) reconstructs a full PhysicalSchema
 * from a live database — the foundation of `pylon db baseline`. We create tables
 * via the ORM, then prove the introspected schema recovers columns + types + PK
 * + FK + unique faithfully.
 */
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {applyChanges, diffSchema} from '@getcronit/pylon-ir'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  array,
  boolean,
  connect,
  Database,
  foreignKey,
  generateModelSource,
  id,
  introspectPhysical,
  manager,
  MigrationRunner,
  Model,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'

class IpAuthor extends Model {
  static config = {table: 'ip_author'} satisfies ModelConfig<IpAuthor>
  static objects = manager(IpAuthor)
  id = id()
  email = text({unique: true})
  active = boolean({default: true})
  tags = array(text())
}
new Pylon({db: {models: [IpAuthor]}})

class IpBook extends Model {
  static config = {table: 'ip_book'} satisfies ModelConfig<IpBook>
  static objects = manager(IpBook)
  id = id()
  title = text()
  authorId = foreignKey(() => IpAuthor)
}
new Pylon({db: {models: [IpBook]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('introspectPhysical (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('ip_book').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('ip_author').ifExists().cascade().execute()
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('ip_book').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('ip_author').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('recovers tables, columns and types', async () => {
    const schema = await introspectPhysical(db)
    expect(schema.ip_author).toBeDefined()
    expect(schema.ip_book).toBeDefined()
    // excludes the migration ledger
    expect(schema._pylon_migrations).toBeUndefined()

    const author = schema.ip_author
    const byName = Object.fromEntries(author.columns.map(c => [c.name, c]))
    expect(byName.id).toMatchObject({sqlType: 'bigint', primaryKey: true, autoIncrement: true})
    expect(byName.email).toMatchObject({sqlType: 'text', unique: true, nullable: false})
    expect(byName.active).toMatchObject({sqlType: 'boolean'})
    expect(byName.tags).toMatchObject({sqlType: 'text', array: true})
  })

  it('recovers a single-column primary key', async () => {
    const schema = await introspectPhysical(db)
    const pks = schema.ip_book.columns.filter(c => c.primaryKey).map(c => c.name)
    expect(pks).toEqual(['id'])
  })

  it('recovers foreign keys with their referenced table + delete rule', async () => {
    const schema = await introspectPhysical(db)
    const fk = schema.ip_book.foreignKeys?.find(f => f.column === 'author_id')
    expect(fk).toBeDefined()
    expect(fk).toMatchObject({refTable: 'ip_author', refColumn: 'id'})
    expect(['cascade', 'set null', 'no action', 'restrict']).toContain(fk!.onDelete)
  })

  it('baseline writes an initial migration whose ops reconstruct the schema', async () => {
    const schema = await introspectPhysical(db)
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-baseline-'))
    try {
      const runner = new MigrationRunner({dir: tmp})
      const created = await runner.baseline(schema, 'baseline')
      expect(created).not.toBeNull()
      expect(created!.name).toMatch(/_baseline$/)

      // The migration file was written.
      const files = await fs.readdir(tmp)
      expect(files.some(f => f.endsWith('_baseline.ts'))).toBe(true)

      // Folding the emitted ops from empty reconstructs exactly the introspected
      // schema for our two tables (no spurious diff).
      const folded = applyChanges({}, created!.changes as any)
      const onlyOurs = (s: any) =>
        Object.fromEntries(
          Object.entries(s).filter(([k]) => k === 'ip_author' || k === 'ip_book')
        )
      expect(diffSchema(onlyOurs(folded), onlyOurs(schema))).toEqual([])
    } finally {
      await fs.rm(tmp, {recursive: true, force: true})
    }
  })

  it('baseline refuses to run when migrations already exist', async () => {
    const schema = await introspectPhysical(db)
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-baseline-'))
    try {
      const runner = new MigrationRunner({dir: tmp})
      await runner.baseline(schema, 'baseline')
      await expect(runner.baseline(schema, 'baseline')).rejects.toThrow(/already exist/)
    } finally {
      await fs.rm(tmp, {recursive: true, force: true})
    }
  })

  it('generateModelSource emits id() and foreignKey() stubs from the schema', async () => {
    const schema = await introspectPhysical(db)
    const src = generateModelSource(schema)
    expect(src).toMatch(/export class IpAuthor extends Model/)
    expect(src).toMatch(/export class IpBook extends Model/)
    expect(src).toMatch(/id = id\(\)/)
    expect(src).toMatch(/authorId = foreignKey\(\(\) => IpAuthor/)
    expect(src).toMatch(/tags = array\(text\(\)\)/)
  })
})
