import {Pylon} from '@getcronit/pylon'

class Post {
  id!: string
  title!: string
}
class PostEdge {
  cursor!: string
  node!: Post
}
class PageInfo {
  hasNextPage!: boolean
  hasPreviousPage!: boolean
  startCursor?: string
  endCursor?: string
}
class PostConnection {
  edges!: PostEdge[]
  pageInfo!: PageInfo
  totalCount!: number
}

const ALL: Post[] = Array.from({length: 25}, (_, i) =>
  Object.assign(new Post(), {id: String(i + 1), title: `Post ${i + 1}`})
)

export default new Pylon({
  graphql: {
    Query: {
      posts: (first: number, after?: string): PostConnection => {
        const start = after ? ALL.findIndex(p => p.id === after) + 1 : 0
        const slice = ALL.slice(start, start + (first ?? 10))
        return Object.assign(new PostConnection(), {
          edges: slice.map(p =>
            Object.assign(new PostEdge(), {cursor: p.id, node: p})
          ),
          pageInfo: Object.assign(new PageInfo(), {
            hasNextPage: start + slice.length < ALL.length,
            hasPreviousPage: start > 0,
            startCursor: slice[0]?.id,
            endCursor: slice[slice.length - 1]?.id
          }),
          totalCount: ALL.length
        })
      }
    },
    Mutation: {}
  }
})
