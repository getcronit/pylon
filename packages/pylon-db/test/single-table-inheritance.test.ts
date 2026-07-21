/**
 * SPEC (pre-implementation) for Single-Table Inheritance — see
 * SINGLE_TABLE_INHERITANCE_DESIGN.md. These describe the INTENDED contract and
 * are expected to FAIL until the feature is built; review them before building.
 *
 * Unified model: a base model + subclasses that `extends` it collapse to ONE
 * table + a discriminator column; the base projects to `interface <ClassName>`
 * (NO `I` prefix, no concrete `type <ClassName>`) while STAYING a usable ORM
 * model (`Base.objects.get(id)` / `create`). Subclasses become the implementing
 * types.
 */
import {diffSchema, physicalSchemaOf, toDDL, toSDL, tableSpecOf} from '@getcronit/pylon-ir'
import {describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {Model, id, text, type ModelConfig} from '../src/index'
import {toIR} from '../src/ir'

// ── Fixture: one `files_asset` table, discriminated by `type` ─────────────────
// The base opts into single-table inheritance and names its discriminator; each
// subclass declares its `discriminatorValue` and adds its own columns. This is
// the proposed config surface (concrete-base / "default" mode).

class Asset extends Model {
  // Base annotates (wide type) so subclass `static config` stays assignable to it.
  static config: ModelConfig<Asset> = {
    table: 'files_asset',
    inheritance: {strategy: 'single-table', discriminator: 'type'},
  }
  id = id()
  name = text()
  type = text() // discriminator column: FILE | FOLDER | EXTERNAL_VIDEO
  mimeType = text({nullable: true})
}

class FileAsset extends Asset {
  static config = {discriminatorValue: 'FILE'} satisfies ModelConfig<FileAsset, 'type'>
  s3Key = text({nullable: true})
}

class VideoAsset extends Asset {
  static config = {discriminatorValue: 'EXTERNAL_VIDEO'} satisfies ModelConfig<VideoAsset, 'type'>
  // Declared NON-null on purpose: STI must FORCE subclass columns nullable on the
  // shared table, because FILE/FOLDER rows legitimately leave them null.
  externalUrl = text()
  host = text()
}

new Pylon({db: {models: [Asset, FileAsset, VideoAsset]}})

const full = toIR()
const sharedTable = () => tableSpecOf(full.entities.Asset)
const col = (name: string) => sharedTable().columns.find(c => c.name === name)

describe('STI — physical schema: one shared table', () => {
  it('maps every model in the group to the SAME physical table', () => {
    expect(full.entities.Asset.table).toBe('files_asset')
    expect(full.entities.FileAsset.table).toBe('files_asset')
    expect(full.entities.VideoAsset.table).toBe('files_asset')
  })

  it('produces exactly ONE physical table for the whole group (no per-subclass tables)', () => {
    const tables = new Set(Object.values(full.entities).map(e => e.table))
    expect(tables).toEqual(new Set(['files_asset']))
  })

  it('unions every subclass column onto the shared table', () => {
    const names = sharedTable().columns.map(c => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'type',
        'mime_type',
        's3_key', // from FileAsset
        'external_url', // from VideoAsset
        'host', // from VideoAsset
      ]),
    )
  })

  it('forces subclass columns NULLABLE on the shared table (even if declared non-null)', () => {
    // externalUrl/host were declared non-null on VideoAsset — a FILE row has no
    // value for them, so STI must relax them to nullable.
    expect(col('external_url')?.nullable).toBe(true)
    expect(col('host')?.nullable).toBe(true)
    expect(col('s3_key')?.nullable).toBe(true)
  })

  it('keeps base + discriminator columns NOT NULL', () => {
    expect(col('id')?.nullable).toBeFalsy()
    expect(col('name')?.nullable).toBeFalsy()
    expect(col('type')?.nullable).toBeFalsy()
  })

  it('emits a single CREATE TABLE for the group', () => {
    const ddl = toDDL(sharedTable())
    expect(ddl).toMatch(/CREATE TABLE "files_asset"/)
    expect(ddl.match(/CREATE TABLE/g)?.length).toBe(1)
    // subclass columns present in the one table
    expect(ddl).toMatch(/"external_url"\s+text/)
    expect(ddl).toMatch(/"s3_key"\s+text/)
    // no per-subclass tables leaked into the DDL
    expect(ddl).not.toMatch(/video_asset|file_asset/)
  })
})

describe('STI — GraphQL entities: one type per subclass', () => {
  it('emits one entity per model in the group (base + subclasses)', () => {
    expect(Object.keys(full.entities).sort()).toEqual([
      'Asset',
      'FileAsset',
      'VideoAsset',
    ])
  })

  it('exposes each subclass’s own fields on its entity', () => {
    const has = (entity: string, field: string) =>
      full.entities[entity].fields.some(f => f.name === field)
    expect(has('VideoAsset', 'externalUrl')).toBe(true)
    expect(has('VideoAsset', 'host')).toBe(true)
    expect(has('FileAsset', 's3Key')).toBe(true)
    // subclass fields do NOT bleed across siblings
    expect(has('FileAsset', 'externalUrl')).toBe(false)
    expect(has('VideoAsset', 's3Key')).toBe(false)
    // shared fields are on every entity
    expect(has('VideoAsset', 'name')).toBe(true)
    expect(has('FileAsset', 'name')).toBe(true)
  })
})

describe('STI — GraphQL: base is `interface <ClassName>` (no I prefix)', () => {
  const sdl = toSDL(full)

  it('projects the base as an interface named after the class', () => {
    expect(sdl).toMatch(/\binterface Asset\b/)
  })

  it('does NOT use the I-prefix fallback', () => {
    expect(sdl).not.toMatch(/\binterface IAsset\b/)
  })

  it('does NOT emit a concrete object type for the base', () => {
    expect(sdl).not.toMatch(/\btype Asset\b/)
  })

  it('each subclass implements the class-named interface', () => {
    expect(sdl).toMatch(/type FileAsset implements Asset\b/)
    expect(sdl).toMatch(/type VideoAsset implements Asset\b/)
  })
})

describe('STI — migration: ONE physical table (physicalSchemaOf / diff engine)', () => {
  const physical = physicalSchemaOf(full.entities)

  it('projects exactly one table for the STI group; subclasses are skipped', () => {
    const filesAsset = Object.values(physical).filter(t => t.table === 'files_asset')
    expect(filesAsset).toHaveLength(1)
    expect(Object.keys(physical)).toContain('Asset')
    expect(Object.keys(physical)).not.toContain('FileAsset')
    expect(Object.keys(physical)).not.toContain('VideoAsset')
  })

  it('the one table carries the merged union of columns', () => {
    const t = Object.values(physical).find(x => x.table === 'files_asset')!
    expect(t.columns.map(c => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'type',
        'mime_type',
        's3_key',
        'external_url',
        'host'
      ])
    )
  })

  it('the diff engine emits exactly ONE createTable for the group', () => {
    const changes = diffSchema({}, physical)
    const creates = changes.filter(
      (c): c is Extract<typeof c, {kind: 'createTable'}> => c.kind === 'createTable'
    )
    const filesAsset = creates.filter(c => c.spec.table === 'files_asset')
    expect(filesAsset).toHaveLength(1)
    expect(creates.some(c => ['file_asset', 'video_asset'].includes(c.spec.table))).toBe(
      false
    )
  })
})

// ── Registration invariants (validated at Pylon() construction) ──────────────
describe('STI — registration invariants', () => {
  it.todo(
    'rejects a subclass whose discriminatorValue duplicates a sibling’s',
  )
  it.todo(
    'rejects two subclass columns that share a name with conflicting types',
  )
  it.todo(
    'generates a fallback implementer (`AssetDefault implements Asset`) for discriminator values with no subclass',
  )
  it.todo(
    'rejects combining `inheritance.strategy:"single-table"` with `abstract:true` on the same base',
  )
})

// The runtime contract — base stays a usable manager, discriminator scoping on
// subclass managers, create stamping the discriminator, and base→subclass
// materialisation — is verified end-to-end against a real Postgres in
// `test/integration/sti-runtime.test.ts`.
//
// Still open: un-subclassed values → a generated fallback implementer (§2.4 of the
// design); the concrete-base variant currently materialises them as the base.
