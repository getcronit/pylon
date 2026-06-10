// shop app — manifest. Depends on `blog` (its Purchase FK targets blog.Author),
// so migrations apply after blog and the cross-app FK resolves.
import {defineApp} from '@getcronit/pylon'
import {Author} from '../blog/models.js'
import {Product, Purchase} from './models.js'

export const shop = defineApp({
  name: 'shop',
  models: [Product, Purchase],
  dependencies: ['blog'],
  graphql: {
    Query: {
      product: (id: number): Promise<Product> => Product.objects.get({id}),
      products: (): Promise<Product[]> => Product.objects.all(),
      purchase: (id: number): Promise<Purchase> => Purchase.objects.get({id})
    },
    Mutation: {
      addProduct: (title: string, price: number): Promise<Product> =>
        Product.objects.create({title, price}),
      buy: (productId: number, buyerId: number): Promise<Purchase> =>
        Purchase.objects.create({productId, buyerId})
    }
  }
})

// re-export so the host can traverse the cross-app relation type if needed
export type {Author}
