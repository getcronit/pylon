/**
 * STI runtime against a real Postgres: one shared table, subclass create stamps
 * the discriminator, base `get`/`all` materialise the concrete subclass, and a
 * subclass manager is scoped to its discriminator.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {sql} from 'kysely'
import {
  Model,
  connect,
  Database,
  enumOf,
  id,
  manager,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'

enum AssetType {
  FILE = 'FILE',
  EXTERNAL_VIDEO = 'EXTERNAL_VIDEO'
}

class Asset extends Model {
  static objects = manager(Asset)
  static config = {
    table: 'files_asset',
    inheritance: {strategy: 'single-table', discriminator: 'type'}
  }
  id = id()
  name = text()
  type = enumOf(AssetType)
}
class FileAsset extends Asset {
  static objects = manager(FileAsset)
  static config = {discriminatorValue: AssetType.FILE}
  s3Key = text({nullable: true})
}
class VideoAsset extends Asset {
  static objects = manager(VideoAsset)
  static config = {discriminatorValue: AssetType.EXTERNAL_VIDEO}
  // REQUIRED on the subclass — even though the shared physical column must be nullable
  // (a FileAsset row has no externalUrl). Non-null here = GraphQL `String!` + validated
  // on create; the physical NULL-ability is decoupled.
  externalUrl = text()
}
new Pylon({db: {models: [Asset, FileAsset, VideoAsset]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('STI runtime (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['files_asset', 'file_asset', 'video_asset']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('files_asset').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('creates ONE shared table with the union of columns (no per-subclass tables)', async () => {
    const {rows} = await sql<{table_name: string}>`
      select table_name from information_schema.tables where table_schema = 'public'
    `.execute(db.kysely)
    const names = rows.map(r => r.table_name)
    expect(names).toContain('files_asset')
    expect(names).not.toContain('file_asset')
    expect(names).not.toContain('video_asset')

    const {rows: cols} = await sql<{column_name: string}>`
      select column_name from information_schema.columns where table_name = 'files_asset'
    `.execute(db.kysely)
    const colNames = cols.map(c => c.column_name)
    expect(colNames).toEqual(
      expect.arrayContaining(['id', 'name', 'type', 's3_key', 'external_url'])
    )
  })

  it('subclass create stamps the discriminator + returns the concrete type', async () => {
    const v = await VideoAsset.objects.create({
      name: 'promo',
      externalUrl: 'https://youtu.be/x'
    })
    expect(v).toBeInstanceOf(VideoAsset)
    expect((v as unknown as {type: string}).type).toBe(AssetType.EXTERNAL_VIDEO)
    expect(v.externalUrl).toBe('https://youtu.be/x')
  })

  it('Base.objects.create resolves the subclass from the discriminator value', async () => {
    // No subclass manager: the BASE create picks the concrete class off `type`.
    const v = await Asset.objects.create({
      name: 'via-base',
      type: AssetType.EXTERNAL_VIDEO,
      externalUrl: 'https://youtu.be/base'
    } as Partial<Asset>)
    expect(v).toBeInstanceOf(VideoAsset)
    expect((v as unknown as {externalUrl: string}).externalUrl).toBe('https://youtu.be/base')
    // …and it round-trips as the subclass.
    const got = await Asset.objects.get({id: v.id})
    expect(got).toBeInstanceOf(VideoAsset)
  })

  it('a required subclass field is enforced at create yet stays physically nullable', async () => {
    // The shared column is physically nullable → a FileAsset row (no externalUrl) inserts.
    const f = await FileAsset.objects.create({name: 'no-url', s3Key: 's3://x'})
    expect(f).toBeInstanceOf(FileAsset)
    // But externalUrl is non-null on VideoAsset → creating one without it throws at
    // runtime (validation), not via a DB NOT NULL constraint.
    await expect(
      VideoAsset.objects.create({name: 'bad'} as Partial<VideoAsset>)
    ).rejects.toThrow(/externalUrl|required/i)
  })

  it('Base.objects.get(id) materialises the concrete subclass', async () => {
    const f = await FileAsset.objects.create({name: 'doc', s3Key: 's3://k'})
    const got = await Asset.objects.get({id: f.id})
    expect(got).toBeInstanceOf(FileAsset)
    expect((got as unknown as {s3Key: string}).s3Key).toBe('s3://k')
  })

  it('the base can FILTER and ORDER BY a subclass column (shared table)', async () => {
    await FileAsset.objects.create({name: 'keyed', s3Key: 's3://unique-key'})
    // `s3Key` is a FileAsset-only column; the BASE manager resolves it (columnFor is
    // STI-aware), so a base query can filter by it — returns the concrete subclass.
    const hits = await Asset.objects
      .filter({s3Key: 's3://unique-key'} as Partial<Asset>)
      .all()
    expect(hits.length).toBe(1)
    expect(hits[0]).toBeInstanceOf(FileAsset)
    // …and ORDER BY a subclass column doesn't throw.
    const ordered = await Asset.objects.orderBy('s3Key' as keyof Asset).all()
    expect(ordered.length).toBeGreaterThan(0)
  })

  it('a subclass manager is scoped to its discriminator (no crossover)', async () => {
    const videos = await VideoAsset.objects.all()
    expect(videos.length).toBeGreaterThan(0)
    expect(videos.every(v => v instanceof VideoAsset)).toBe(true)
    expect(videos.some(v => v instanceof FileAsset)).toBe(false)

    const files = await FileAsset.objects.all()
    expect(files.every(f => f instanceof FileAsset)).toBe(true)
  })

  it('Base.objects.all() spans every kind, each materialised to its subclass', async () => {
    const all = await Asset.objects.all()
    const kinds = new Set(all.map(a => a.constructor.name))
    expect(kinds).toContain('FileAsset')
    expect(kinds).toContain('VideoAsset')
  })
})
