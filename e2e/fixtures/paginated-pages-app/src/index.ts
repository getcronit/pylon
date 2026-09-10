import {Pylon} from '@getcronit/pylon'

class Comment {
  id!: string
  body!: string
}
class CommentEdge {
  cursor!: string
  node!: Comment
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
class CommentConnection {
  edges!: CommentEdge[]
  pageInfo!: PageInfo
  totalCount!: number
}
class PostConnection {
  edges!: PostEdge[]
  pageInfo!: PageInfo
  totalCount!: number
}

const COMMENTS: Comment[] = Array.from({length: 12}, (_, i) =>
  Object.assign(new Comment(), {id: 'c' + (i + 1), body: 'Comment ' + (i + 1)})
)

function page<T extends {id: string}>(
  all: T[],
  first: number,
  after: string | undefined,
  make: (edges: any[], info: PageInfo, total: number) => any
) {
  const start = after ? all.findIndex(x => x.id === after) + 1 : 0
  const slice = all.slice(start, start + (first ?? 10))
  const info = Object.assign(new PageInfo(), {
    hasNextPage: start + slice.length < all.length,
    hasPreviousPage: start > 0,
    startCursor: slice[0]?.id,
    endCursor: slice[slice.length - 1]?.id
  })
  return make(slice, info, all.length)
}

class Post {
  id!: string
  title!: string
  // nested paginated connection rooted at this post
  comments(first: number, after?: string, role?: string): CommentConnection {
    return page(COMMENTS, first, after, (slice, info, total) =>
      Object.assign(new CommentConnection(), {
        edges: slice.map(c =>
          Object.assign(new CommentEdge(), {cursor: c.id, node: c})
        ),
        pageInfo: info,
        totalCount: total
      })
    )
  }
}

const POSTS: Post[] = Array.from({length: 25}, (_, i) =>
  Object.assign(new Post(), {id: String(i + 1), title: `Post ${i + 1}`})
)

export default new Pylon({
  graphql: {
    Query: {
      posts: (first: number, after?: string): PostConnection =>
        page(POSTS, first, after, (slice, info, total) =>
          Object.assign(new PostConnection(), {
            edges: slice.map(p =>
              Object.assign(new PostEdge(), {cursor: p.id, node: p})
            ),
            pageInfo: info,
            totalCount: total
          })
        ),
      post: (id: string): Post =>
        Object.assign(new Post(), {id, title: `Post ${id}`})
    },
    Mutation: {}
  }
})
