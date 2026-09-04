/**
 * Deep introspection (`introspectPhysical`) reconstructs a full PhysicalSchema
 * from a live database — the foundation of `pylon db baseline`. We create tables
 * via the ORM, then prove the introspected schema recovers columns + types + PK
 * + FK + unique faithfully.
 */
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyChanges,
  diffSchema,
  type OnDelete,
  type PhysicalSchema,
  type PhysicalTable,
  type SqlType,
  type TableColumn
} from '@getcronit/pylon/ir'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  array,
  boolean,
  connect,
  Database,
  foreignKey,
  computeDeepDrift,
  generateModelSource,
  id,
  introspectPhysical,
  manager,
  MigrationRunner,
  Model,
  setDefaultDatabase,
  syncSchema,
  text
} from '@/db/index'

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

/**
 * Deep drift: a column present under the right NAME but the wrong shape.
 *
 * Presence-level drift called this "in sync" — the column exists on both sides —
 * which made the `pylon db check` gate blind to exactly the change you most want
 * to hear about: a type hand-altered out of band, a dropped NOT NULL, a foreign
 * key removed by a hotfix.
 */
describe.skipIf(!runDb)('computeDeepDrift', () => {
  const col = (name: string, sqlType: SqlType, extra: Partial<TableColumn> = {}): TableColumn =>
    ({
      property: name,
      name,
      sqlType,
      primaryKey: false,
      autoIncrement: false,
      unique: false,
      nullable: false,
      ...extra
    }) as TableColumn

  const schema = (cols: TableColumn[], extra: Partial<PhysicalTable> = {}): PhysicalSchema => ({
    T: {name: 'T', table: 't', columns: cols, foreignKeys: [], indexes: [], ...extra}
  })

  it('is silent when the database matches', () => {
    const s = schema([col('id', 'bigint', {primaryKey: true, autoIncrement: true}), col('a', 'text')])
    expect(computeDeepDrift(s, s)).toEqual([])
  })

  it('catches a changed type, nullability, uniqueness and primary key', () => {
    const want = schema([col('a', 'text'), col('b', 'text'), col('c', 'text'), col('d', 'text')])
    const live = schema([
      col('a', 'integer'),
      col('b', 'text', {nullable: true}),
      col('c', 'text', {unique: true}),
      col('d', 'text', {primaryKey: true})
    ])
    const drift = computeDeepDrift(live, want)
    expect(drift.join('\n')).toMatch(/t\.a: sqlType is "integer" in the database, models expect "text"/)
    expect(drift.join('\n')).toMatch(/t\.b: nullable is true in the database, models expect false/)
    expect(drift.join('\n')).toMatch(/t\.c: unique is true in the database, models expect false/)
    expect(drift.join('\n')).toMatch(/t\.d: primaryKey is true in the database, models expect false/)
  })

  it('treats an absent ON DELETE and NO ACTION as the same rule', () => {
    const fk = (onDelete?: OnDelete) => ({
      table: 't',
      name: 't_x_fkey',
      column: 'x',
      refTable: 'u',
      refColumn: 'id',
      ...(onDelete ? {onDelete} : {})
    })
    const want = schema([col('x', 'bigint')], {foreignKeys: [fk()]})
    const live = schema([col('x', 'bigint')], {foreignKeys: [fk('no action' as OnDelete)]})
    // Postgres reports the default rule as NO ACTION; a model that says nothing
    // means the same. Without this every plain FK reads as drift.
    expect(computeDeepDrift(live, want)).toEqual([])
    // A rule that genuinely differs is still reported.
    const cascade = schema([col('x', 'bigint')], {foreignKeys: [fk('cascade' as OnDelete)]})
    expect(computeDeepDrift(live, cascade).join('\n')).toMatch(/ON DELETE is "no action" .* expect "cascade"/)
  })

  it('catches a missing foreign key and a missing index', () => {
    const want = schema([col('x', 'bigint')], {
      foreignKeys: [{table: 't', name: 't_x_fkey', column: 'x', refTable: 'u', refColumn: 'id'}],
      indexes: [{name: 't_x_idx', table: 't', columns: ['x'], unique: false}]
    })
    const live = schema([col('x', 'bigint')])
    const drift = computeDeepDrift(live, want).join('\n')
    expect(drift).toMatch(/foreign key "t_x_fkey" \(x → u\.id\) is missing/)
    expect(drift).toMatch(/index "t_x_idx" \(x\) is missing/)
  })

  it('skips generated columns — their type is derived and their expression rewritten', () => {
    const want = schema([col('doc', 'tsvector', {generatedAs: "to_tsvector('simple', a)"})])
    const live = schema([col('doc', 'text')]) // what Postgres reports before the type fix
    expect(computeDeepDrift(live, want)).toEqual([])
  })

  it('ignores extra tables — a shared database holds other apps', () => {
    const want = schema([col('a', 'text')])
    const live: PhysicalSchema = {
      ...schema([col('a', 'text')]),
      Other: {name: 'Other', table: 'other', columns: [col('z', 'text')], foreignKeys: [], indexes: []}
    }
    expect(computeDeepDrift(live, want)).toEqual([])
  })
})
