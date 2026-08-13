/**
 * `models.Struct<T>` (full build) — a jsonb column exposed on the wire as its STRUCTURED generic
 * `T`, a real GraphQL object type with selectable subfields (the opt-in counterpart to the opaque
 * `models.JSON` scalar).
 *
 * A model like
 *
 *   class AuditEvent extends Model {
 *     metadata = models.Struct<AuditMeta | null>({nullable: true})   // AuditMeta is a concrete type
 *   }
 *
 * queried via `auditEvent(): AuditEvent` must produce exactly one `type AuditEvent` whose
 * `metadata` field is `AuditMeta` (NOT the `JSON` scalar), with `AuditMeta` (and its nested
 * `Target`) present and referenced — so a client can select `metadata { v target { id } }`.
 *
 * The ORM contributes the jsonb column with a `struct` flag; `mergeFields` keeps the parser's
 * reflected object type over the ORM's `JSON` placeholder (same seam as enum columns), and the
 * orphan-prune leaves the now-referenced types in place. Real SchemaBuilder so the generic resolves.
 */
import path from 'path'
import {fileURLToPath} from 'url'
import {toIR} from '@getcronit/pylon/db'
import {buildSchema, GraphQLObjectType} from 'graphql'
import {describe, expect, it} from 'vitest'
import {SchemaBuilder} from '../builder'
// Import the fixture so its `new Pylon({db:{models:[AuditEvent]}})` registers the model for `toIR`.
import './fixtures/struct-generic-model/index'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENTRY = path.resolve(HERE, 'fixtures/struct-generic-model/index.ts')

describe('full build: models.Struct<T> surfaces the structured generic on the wire', () => {
  it('one AuditEvent, metadata: AuditMeta object type, queryable subfields, valid SDL', () => {
    const contributeIR = toIR(undefined, {node: true})
    const {typeDefs} = new SchemaBuilder(ENTRY).build({contributeIR})

    expect((typeDefs.match(/type AuditEvent\b/g) ?? []).length, 'exactly one AuditEvent').toBe(1)
    expect(() => buildSchema(typeDefs), 'valid SDL').not.toThrow()
    expect(typeDefs, 'metadata is the structured generic, not the JSON scalar').toMatch(
      /metadata: AuditMeta/
    )
    expect(typeDefs, 'the structured type is emitted (referenced, not pruned)').toMatch(
      /type AuditMeta\b/
    )

    // The built schema must expose metadata as a selectable object type.
    const schema = buildSchema(typeDefs)
    const auditEvent = schema.getType('AuditEvent') as GraphQLObjectType
    const metadataType = auditEvent.getFields().metadata.type
    expect(String(metadataType), 'metadata resolves to the AuditMeta object type').toMatch(
      /AuditMeta/
    )
    expect(schema.getType('AuditMeta'), 'AuditMeta is a real object type').toBeInstanceOf(
      GraphQLObjectType
    )
  })
})
