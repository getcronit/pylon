/**
 * REGRESSION (full build) — a `models.JSON<T>` column stays a clean, opaque `JSON` scalar, and the
 * object type the type-checker reflected for the generic `T` is NOT leaked into the SDL.
 *
 * `models.JSON` is deliberately opaque: a jsonb column read/written whole, queried BARE (no subfield
 * selection). The type parameter types the backend value + is a cast target — it does not surface a
 * GraphQL object type. When a client needs to select into the shape, that is `models.Struct<T>`
 * (see struct_generic_type.test.ts).
 *
 * The historical bug: the parser reflected `T` (`AuditMeta`, and its nested `Target`) as object
 * types, but the ORM collapsed the column to `JSON` — leaving `AuditMeta`/`Target` in the SDL as
 * ORPHANS (and, in a fuller build, a DUPLICATE `type AuditEvent` — invalid SDL that only slips
 * through `assumeValidSDL: true`, then breaks queries: "Field metadata must not have a selection
 * since type JSON has no subfields"). The post-merge object-type prune removes them.
 *
 * Uses the REAL SchemaBuilder (fixtures/json-generic-model) so the generic resolves — the in-memory
 * harness yields `Any`, and the isolated mergeIR seam (json_generic_entity_merge.test.ts) never
 * reproduced the leak; it only appears in the full multi-file build.
 */
import path from 'path'
import {fileURLToPath} from 'url'
import {toIR} from '@getcronit/pylon-db'
import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {SchemaBuilder} from '../builder'
// Import the fixture so its `new Pylon({db:{models:[AuditEvent]}})` registers the model for `toIR`.
import './fixtures/json-generic-model/index'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENTRY = path.resolve(HERE, 'fixtures/json-generic-model/index.ts')

describe('full build: models.JSON<T> is an opaque JSON scalar, with no leaked generic types', () => {
  it('one AuditEvent, metadata: JSON, no orphaned AuditMeta/Target, valid SDL', () => {
    const contributeIR = toIR(undefined, {node: true})
    const {typeDefs} = new SchemaBuilder(ENTRY).build({contributeIR})

    expect((typeDefs.match(/type AuditEvent\b/g) ?? []).length, 'exactly one AuditEvent').toBe(1)
    expect(() => buildSchema(typeDefs), 'valid SDL (no duplicate type)').not.toThrow()
    expect(typeDefs, 'metadata stays the opaque JSON scalar').toMatch(/metadata: JSON/)
    // The generic's reflected object types must NOT leak into the schema.
    expect(typeDefs, 'no orphaned AuditMeta type').not.toMatch(/type AuditMeta\b/)
    expect(typeDefs, 'no orphaned Target type').not.toMatch(/type Target\b/)
  })
})
