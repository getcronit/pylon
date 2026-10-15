/**
 * END-TO-END STI: the REAL `SchemaBuilder` over an STI fixture (analyzer IR ⊕
 * ORM IR). Proves the merged output — base → `interface Asset` (no `I`, no
 * concrete `type Asset`), subclasses → implementing types — not just the ORM's
 * `toIR` contribution in isolation.
 */
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it, beforeAll} from 'vitest'
import {
  buildSchema,
  isInterfaceType,
  isObjectType,
  type GraphQLInterfaceType,
  type GraphQLObjectType
} from 'graphql'
import {SchemaBuilder} from '@/cli/builder/schema/builder'
import {toIR} from '@/db/index'
import './fixtures/sti-app'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.resolve(dir, 'fixtures/sti-app.ts')

let typeDefs: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resolvers: Record<string, {__resolveType?: (o: any) => string | null}>

beforeAll(() => {
  // Exercise the REAL merged path (analyzer IR ⊕ ORM `toIR()`), as `pylon build` does.
  const built = new SchemaBuilder(fixture).build({contributeIR: toIR()})
  typeDefs = built.typeDefs
  resolvers = built.resolvers as typeof resolvers
})

describe('STI — full schema build (analyzer ⊕ ORM)', () => {
  it('projects the base as `interface Asset` (named after the class)', () => {
    expect(typeDefs).toMatch(/\binterface Asset\b/)
  })

  it('does NOT use the I-prefix fallback', () => {
    expect(typeDefs).not.toMatch(/\binterface IAsset\b/)
  })

  it('does NOT emit a concrete `type Asset`', () => {
    expect(typeDefs).not.toMatch(/\btype Asset\b/)
  })

  it('each subclass implements Asset', () => {
    expect(typeDefs).toMatch(/type FileAsset implements[^{]*\bAsset\b/)
    expect(typeDefs).toMatch(/type ExternalVideoAsset implements[^{]*\bAsset\b/)
  })

  it('subclass-specific fields live on the subclass type', () => {
    expect(typeDefs).toMatch(/type ExternalVideoAsset[^}]*externalUrl/)
    expect(typeDefs).toMatch(/type FileAsset[^}]*s3Key/)
  })
})

// Parse the whole emitted SDL into a real GraphQLSchema and assert the STI shape
// STRUCTURALLY — the strongest "full schema" check (robust to unrelated types).
describe('STI — full schema (structural, via buildSchema)', () => {
  const fieldNames = (t: GraphQLInterfaceType | GraphQLObjectType) =>
    Object.keys(t.getFields()).sort()

  it('parses into a valid schema — Asset is an INTERFACE, not an object type, no I-twin', () => {
    const schema = buildSchema(typeDefs)
    const asset = schema.getType('Asset')
    expect(asset && isInterfaceType(asset)).toBe(true)
    expect(isObjectType(schema.getType('Asset'))).toBe(false)
    expect(schema.getType('IAsset')).toBeUndefined()
  })

  it('the Asset interface exposes exactly the shared fields, with correct types', () => {
    const asset = buildSchema(typeDefs).getType('Asset') as GraphQLInterfaceType
    expect(fieldNames(asset)).toEqual(['id', 'mimeType', 'name', 'type'])
    const f = asset.getFields()
    expect(String(f.id.type)).toBe('ID!')
    expect(String(f.name.type)).toBe('String!')
    // The discriminator is a non-null enum column → `AssetType!` (nullability comes
    // from the ORM column, not the analyzer's inferred type).
    expect(String(f.type.type)).toBe('AssetType!')
    expect(String(f.mimeType.type)).toBe('String')
  })

  it('FileAsset implements Asset = shared fields + s3Key', () => {
    const t = buildSchema(typeDefs).getType('FileAsset') as GraphQLObjectType
    expect(t.getInterfaces().map(i => i.name)).toContain('Asset')
    expect(fieldNames(t)).toEqual(['id', 'mimeType', 'name', 's3Key', 'type'])
    expect(String(t.getFields().s3Key.type)).toBe('String')
  })

  it('ExternalVideoAsset implements Asset = shared fields + externalUrl', () => {
    const t = buildSchema(typeDefs).getType('ExternalVideoAsset') as GraphQLObjectType
    expect(t.getInterfaces().map(i => i.name)).toContain('Asset')
    expect(fieldNames(t)).toEqual(['externalUrl', 'id', 'mimeType', 'name', 'type'])
  })

  it('a required subtype field emits as NON-NULL even though the physical column is nullable', () => {
    // externalUrl is `text()` (non-null) on the subclass → GraphQL `String!` on the
    // subtype, while the shared physical column stays nullable (folded onto the base).
    const t = buildSchema(typeDefs).getType('ExternalVideoAsset') as GraphQLObjectType
    expect(String(t.getFields().externalUrl.type)).toBe('String!')
  })

  it("Asset's possible types are exactly the two subclasses", () => {
    const schema = buildSchema(typeDefs)
    const asset = schema.getType('Asset') as GraphQLInterfaceType
    const impls = schema
      .getPossibleTypes(asset)
      .map(t => t.name)
      .sort()
    expect(impls).toEqual(['ExternalVideoAsset', 'FileAsset'])
  })

  it('resolvers return the Asset interface (no I-prefix on the wire)', () => {
    const query = buildSchema(typeDefs).getQueryType()!
    expect(String(query.getFields().asset.type)).toBe('Asset!')
    expect(String(query.getFields().assets.type)).toBe('[Asset!]!')
  })

  it('an STI base in a promoted-union interface wires its subclasses as implementers', () => {
    const schema = buildSchema(typeDefs)
    // SearchLike is a promoted union → an interface.
    const searchLike = schema.getType('SearchLike')
    expect(searchLike && isInterfaceType(searchLike)).toBe(true)
    // Its concrete possible types include the STI subclasses (NOT the Asset interface).
    const impls = schema
      .getPossibleTypes(searchLike as GraphQLInterfaceType)
      .map(t => t.name)
      .sort()
    expect(impls).toEqual(['Doc', 'ExternalVideoAsset', 'FileAsset'])
    // The STI interface itself implements the promoted interface.
    const asset = schema.getType('Asset') as GraphQLInterfaceType
    expect(asset.getInterfaces().map(i => i.name)).toContain('SearchLike')
  })

  it('the STI interface resolveType is re-keyed (no `IAsset`) and resolves by __typename', () => {
    const rt = resolvers.Asset?.__resolveType
    expect(typeof rt).toBe('function')
    expect(rt!({__typename: 'FileAsset'})).toBe('FileAsset')
    expect(rt!({__typename: 'ExternalVideoAsset'})).toBe('ExternalVideoAsset')
    expect(resolvers.IAsset).toBeUndefined()
  })

  it('the promoted-union interface resolves the STI subclasses (via __typename)', () => {
    const rt = resolvers.SearchLike?.__resolveType
    expect(rt!({__typename: 'FileAsset'})).toBe('FileAsset')
    expect(rt!({__typename: 'Doc'})).toBe('Doc')
  })

  it('the discriminator enum is emitted with all its values', () => {
    const e = buildSchema(typeDefs).getType('AssetType')
    expect(e).toBeDefined()
    expect(e && 'getValues' in e ? (e as any).getValues().map((v: any) => v.name) : []).toEqual(
      ['FILE', 'FOLDER', 'EXTERNAL_VIDEO']
    )
  })
})
