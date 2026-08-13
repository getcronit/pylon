// Fixture for the full-build Struct test: a pylon-db model with a `models.Struct<Interface>` column,
// exposed via a resolver that returns it. Driven by the real SchemaBuilder in
// struct_generic_type.test.ts (needs real node_modules type resolution so the `models.Struct<AuditMeta>()`
// generic resolves to `AuditMeta`, which the in-memory harness can't). Unlike `models.JSON`, a
// `models.Struct` column exposes the structured object type on the wire (queryable subfields).
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, models} from '@getcronit/pylon/db'

export interface AuditMeta {
  v: number
  target?: {id: string; label?: string | null}
}

export class AuditEvent extends Model {
  static objects = manager(AuditEvent)
  id = id()
  metadata = models.Struct<AuditMeta | null>({nullable: true})
}

export default new Pylon({
  db: {models: [AuditEvent]},
  graphql: {
    Query: {
      auditEvent: (): AuditEvent => ({}) as unknown as AuditEvent
    }
  }
})
