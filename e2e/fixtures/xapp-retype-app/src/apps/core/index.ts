import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon/db'
import type {Relation} from '@getcronit/pylon/db'

// The retype under test: PYLON_RETYPE flips core_location.id's PK type. Each `pylon db`
// invocation is a fresh process, so the env var cleanly picks uuid vs text at diff time.
const idField = () =>
  process.env.PYLON_RETYPE === '1'
    ? models.Text({primaryKey: true})
    : models.UUID({primaryKey: true})

export class Location extends models.Model {
  static objects = db.manager(Location)
  id = idField()
  name = models.Text()
}

// SAME-app FK → Location: when Location.id retypes, this must be bracketed IN the core
// retype migration (Part 1), while the cross-app products FK is coordinated (Phase 2).
export class OpeningDay extends models.Model {
  static objects = db.manager(OpeningDay)
  id = models.ID()
  locationId = models.ForeignKey(() => Location)
  declare location: Relation<Location>
}

export const core = new Pylon({
  name: 'core',
  db: {models: [Location, OpeningDay], migrations: 'src/apps/core/migrations'}
})
