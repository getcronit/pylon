// Exercises `pylon inspect`: a model (→ schema + authz slice) and an app-bound
// queue class (→ queues slice), assembled into one AppModel.
import {Pylon} from '@getcronit/pylon'
import {models, db, type ModelConfig} from '@getcronit/pylon/db'
import {Queue, manager, type QueueConfig} from '@getcronit/pylon/queues'

export class Product extends models.Model {
  static objects = db.manager(Product)
  static config = {secure: true} satisfies ModelConfig<Product>
  id = models.ID()
  name = models.Text()
}

// A queue class — decorator-free; per-queue options live in `static config`.
class Reindex extends Queue<{productId: string}> {
  static config = {attempts: 3} satisfies QueueConfig<Reindex>
  static jobs = manager(Reindex)
  async process() {}
}

const app = new Pylon({
  name: 'shop',
  db: {models: [Product]},
  graphql: {
    Query: {
      products: (): Promise<Product[]> => Product.objects.all()
    }
  },
  queues: [Reindex]
})

export default app
