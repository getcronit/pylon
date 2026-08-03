/**
 * Isolation evidence for a full-build bug: a pylon-db `models.JSON<Interface>` field emits a
 * DUPLICATE entity type in the real build's SDL.
 *
 * A model like
 *
 *   class AuditEvent extends Model {
 *     metadata = models.JSON<AuditMeta | null>()   // AuditMeta is a concrete interface
 *   }
 *
 * queried via `auditEvent(): AuditEvent` produces TWO `type AuditEvent` in `.pylon/schema.graphql`:
 *   • ORM contribution:  `type AuditEvent implements Node { … metadata: JSON }`   (jsonb → JSON)
 *   • parser reflection: `type AuditEvent { … metadata: AuditMeta }`             (the generic)
 *
 * That duplicate is INVALID SDL (`buildSchema` is only spared because the builder passes
 * `assumeValidSDL: true`), and a client analyzer flip-flops between the two typings, breaking
 * queries at runtime ("Field metadata must not have a selection since type JSON has no subfields").
 *
 * This test PINS DOWN that the `parser-IR + mergeIR` seam is NOT the culprit: given the same name
 * overlap, `mergeIR` correctly collapses the reflected type into the ORM entity (one type,
 * `metadata: JSON`). So the duplicate is introduced later, in the full multi-file build — the same
 * "decorated ORM-model type, full-build-only" class already flagged in nullable-refs.test.ts.
 * A failing repro therefore needs a full-build harness, not this unit seam.
 */
import {emptyIR, mergeIR, toSDL, type PylonIR} from '@getcronit/pylon-ir'
import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {buildParser} from './test-utils'

// The ORM contributes AuditEvent as a persisted entity whose `metadata` jsonb column is JSON.
const auditEventEntity: PylonIR = {
  ...emptyIR(),
  entities: {
    AuditEvent: {
      name: 'AuditEvent',
      table: 'audit_event',
      abstract: false,
      primaryKey: 'id',
      implements: [],
      fields: [
        {
          name: 'id',
          type: {kind: 'scalar', name: 'ID', nullable: false},
          exposed: true,
          column: {name: 'id', sqlType: 'bigint', primaryKey: true, autoIncrement: true, unique: false, nullable: false}
        },
        {
          name: 'metadata',
          type: {kind: 'scalar', name: 'JSON', nullable: true},
          exposed: true,
          column: {name: 'metadata', sqlType: 'jsonb', primaryKey: false, autoIncrement: false, unique: false, nullable: true}
        }
      ]
    }
  }
}

describe('models.JSON<Interface> field: entity/reflection merge (isolation)', () => {
  it('mergeIR collapses the reflected type into the ORM entity — one AuditEvent, metadata: JSON', () => {
    // Resolver returns the model type; its `metadata` is typed as a concrete interface (the
    // `models.JSON<AuditMeta>` generic), so the parser reflects a structured `AuditMeta` object.
    const base = buildParser(`
      interface AuditMeta { v: number; target?: { id: string; label?: string | null } }
      class AuditEvent { id: number = 1; metadata: AuditMeta | null = null }
      export const graphql = {
        Query: { auditEvent: (): AuditEvent => ({ id: 1, metadata: null }) as any }
      }
    `).toIR()

    const sdl = toSDL(mergeIR(base, auditEventEntity))

    // The seam is CORRECT here — this is what the full build fails to reproduce.
    const auditEventDefs = (sdl.match(/type AuditEvent\b/g) ?? []).length
    expect(auditEventDefs, 'exactly one `type AuditEvent` in the SDL').toBe(1)
    expect(() => buildSchema(sdl), 'merged SDL must be valid (no duplicate type)').not.toThrow()
    expect(sdl, 'ORM JSON scalar wins for metadata').toMatch(/metadata: JSON/)
    expect(sdl, 'reflected AuditMeta object type must not survive').not.toMatch(/metadata: AuditMeta/)
  })
})
