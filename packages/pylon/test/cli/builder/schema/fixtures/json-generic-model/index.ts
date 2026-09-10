// Fixture for the full-build repro: a pylon-db model with a `models.JSON<Interface>` column,
// exposed via a resolver that returns it. Driven by the real SchemaBuilder in
// repro_json_generic_duplicate_type.test.ts (needs real node_modules type resolution so the
// `models.JSON<AuditMeta>()` generic resolves to `AuditMeta`, which the in-memory harness can't).
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, models} from '@getcronit/pylon/db'

export interface AuditMeta {
  v: number
  target?: {id: string; label?: string | null}
}

export class AuditEvent extends Model {
  static objects = manager(AuditEvent)
  id = id()
  metadata = models.JSON<AuditMeta | null>({nullable: true})
}

export default new Pylon({
  db: {models: [AuditEvent]},
  graphql: {
    Query: {
      auditEvent: (): AuditEvent => ({}) as unknown as AuditEvent
    }
  }
})
