import {Pylon} from '@getcronit/pylon'

// `ok` always resolves; `boom` always throws. Because `boom` is a NON-NULL String, a
// resolver throw nulls it and — with nothing else selected — nulls the whole `data`
// root, so pylon-query sees a TOTAL failure (errors, no usable data) and throws a
// GraphQLResultError at the component's read. That is the exact shape of an upstream
// being down (the ECONNREFUSED case) that this fixture exists to contain.
export default new Pylon({
  graphql: {
    Query: {
      ok: (): string => 'ok',
      boom: (): string => {
        throw new Error('upstream unavailable')
      }
    },
    Mutation: {}
  }
})
