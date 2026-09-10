// shop app — GraphQL resolvers.
import {Product, Purchase} from './index.js'

export const Query = {
  product: (id: number): Promise<Product> => Product.objects.get({id}),
  products: (): Promise<Product[]> => Product.objects.all(),
  purchase: (id: number): Promise<Purchase> => Purchase.objects.get({id})
}

export const Mutation = {
  addProduct: (title: string, price: number): Promise<Product> =>
    Product.objects.create({title, price}),
  buy: (productId: number, buyerId: number): Promise<Purchase> =>
    Purchase.objects.create({productId, buyerId})
}
