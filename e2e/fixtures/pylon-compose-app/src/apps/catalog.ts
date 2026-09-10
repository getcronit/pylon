// A leaf "app" as a Pylon instance: typed GraphQL via the constructor + its own
// routes. The root composes it (merging graphql + mounting these routes).
import {Pylon} from '@getcronit/pylon'

interface Product {
  id: string
  name: string
  price: number
}

export const catalog = new Pylon({
  graphql: {
    Query: {
      product: (id: string): Product => ({id, name: 'Widget', price: 100}),
      products: (): Product[] => []
    },
    Mutation: {
      addProduct: (name: string, price: number): Product => ({id: '1', name, price})
    }
  }
})

catalog.get('/catalog/ping', c => c.text('catalog-ok'))
