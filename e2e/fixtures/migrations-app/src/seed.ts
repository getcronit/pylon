// Seed file: `pylon db seed` runs this against the connected database. It uses
// the ORM directly (the connection is already open) — `Model.objects.*` exactly
// as in app code.
import {ShopCategory} from './index'

export default async function seed() {
  await ShopCategory.objects.create({name: 'Gizmos'})
}
