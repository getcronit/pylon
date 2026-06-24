// Exercises `pylon inspect`: a model (→ schema + authz slice) and an app-bound
// queue class (→ queues slice), assembled into one AppModel.
import {Pylon} from '@getcronit/pylon'
import {models, db, type ModelConfig} from '@getcronit/pylon-db'
import {Queue, enqueuer} from '@getcronit/pylon-queues'

@models.model()
export class Product extends models.Model {
  static objects = db.manager(Product)
  static config = {secure: true} satisfies ModelConfig<Product>
  id = models.ID()
  name = models.Text()
}

const app = new Pylon({
  name: 'shop',
  graphql: {
    Query: {
      products: (): Promise<Product[]> => Product.objects.all()
    }
  }
})

@app.queue({attempts: 3})
class Reindex extends Queue<{productId: string}> {
  static jobs = enqueuer(Reindex)
  async process() {}
}

export default app
