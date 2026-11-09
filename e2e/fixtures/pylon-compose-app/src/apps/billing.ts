import {Pylon} from '@getcronit/pylon'

interface Invoice {
  id: string
  total: number
}

export const billing = new Pylon({
  graphql: {
    Query: {
      invoice: (id: string): Invoice => ({id, total: 0})
    },
    Mutation: {
      issueInvoice: (total: number): Invoice => ({id: '1', total})
    }
  }
})
