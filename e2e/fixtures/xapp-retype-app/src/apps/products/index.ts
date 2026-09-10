import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon/db'
import type {Relation} from '@getcronit/pylon/db'
import {Location} from '../core/index.js'

// products_inventory_level.location_id is a CROSS-APP FK → core_location.id, and its
// column type FOLLOWS the target PK — so it retypes together with core_location.id.
export class InventoryLevel extends models.Model {
  static objects = db.manager(InventoryLevel)
  id = models.ID()
  locationId = models.ForeignKey(() => Location)
  declare location: Relation<Location>
}

export const products = new Pylon({
  name: 'products',
  db: {models: [InventoryLevel], migrations: 'src/apps/products/migrations'}
})
