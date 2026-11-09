/**
 * STI fixture — a real Pylon entrypoint with single-table-inheritance models.
 * Compiled by the real `SchemaBuilder` (analyzer IR ⊕ ORM IR) so the integration
 * test asserts the END-TO-END SDL, not just the ORM's `toIR` contribution.
 */
import {Pylon} from '@getcronit/pylon'
import {Model, id, text, enumOf, type ModelConfig} from '@/db/index.js'

export enum AssetType {
  FILE = 'FILE',
  FOLDER = 'FOLDER',
  EXTERNAL_VIDEO = 'EXTERNAL_VIDEO'
}

// STI base — projects to `interface Asset`, owns the shared `files_asset` table.
export class Asset extends Model {
  // Base annotates (wide type) so subclass `static config` stays assignable to it
  // — TS enforces static-member compatibility across `extends`.
  static config: ModelConfig<Asset> = {
    table: 'files_asset',
    inheritance: {strategy: 'single-table', discriminator: 'type'}
  }
  id = id()
  name = text()
  type = enumOf(AssetType)
  mimeType = text({nullable: true})
}

export class FileAsset extends Asset {
  // `'type'` (the discriminator key) type-checks the value against `type: AssetType`.
  static config = {discriminatorValue: AssetType.FILE} satisfies ModelConfig<FileAsset, 'type'>
  s3Key = text({nullable: true})
}

export class ExternalVideoAsset extends Asset {
  static config = {
    discriminatorValue: AssetType.EXTERNAL_VIDEO
  } satisfies ModelConfig<ExternalVideoAsset, 'type'>
  // REQUIRED on the subtype (→ GraphQL `String!`) even though the shared physical
  // column is nullable — decoupled logical vs physical nullability.
  externalUrl = text()
}

// A plain, non-STI entity — the other member of a union with the STI base, to
// mirror `search.ts`'s `SearchEntity = … | Asset` (a union Pylon promotes to an
// interface, since the members share `id`).
export class Doc extends Model {
  id = id()
  title = text()
}

new Pylon({db: {models: [Asset, FileAsset, ExternalVideoAsset, Doc]}})

type SearchLike = Doc | Asset

// Polymorphic access points — resolvers return the base, so the schema builder
// reaches Asset (→ interface) and its subclasses (→ implementing types).
export default {
  Query: {
    asset: (): Promise<Asset> => null as unknown as Promise<Asset>,
    assets: (): Promise<Asset[]> => null as unknown as Promise<Asset[]>,
    hits: (): Promise<SearchLike[]> => null as unknown as Promise<SearchLike[]>
  }
}
