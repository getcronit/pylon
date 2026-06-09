// A non-ORM Pylon app: a content platform. Exercises a broad slice of GraphQL
// features through plain TypeScript — enums, interfaces (inheritance), unions,
// self-referential types, lists (incl. nested), nullability, input objects,
// positional + object args, Date scalar, and async resolvers.

// --- Enums (string-literal unions) ---
type Role = 'ADMIN' | 'AUTHOR' | 'READER'
type PostStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

// --- Interface via inheritance ---
class Media {
  id!: string
  url!: string
}
class Image extends Media {
  width!: number
  height!: number
  altText!: string | null
}
class Video extends Media {
  durationSeconds!: number
  captions!: string[]
}

// --- Core domain ---
class User {
  id!: string
  name!: string
  email!: string | null
  role!: Role
  avatar!: Image | null
}

class Comment {
  id!: string
  body!: string
  author!: User
  replies!: Comment[] // self-referential
  createdAt!: Date
}

class Post {
  id!: string
  title!: string
  body!: string
  status!: PostStatus
  author!: User
  tags!: string[]
  comments!: Comment[]
  media!: Media[]
  trailer!: Video | null
  related!: Post[]
  tagMatrix!: string[][] // nested list
  createdAt!: Date
}

// --- Union ---
type SearchResult = Post | User

export const graphql = {
  Query: {
    me: (): User | null => null,
    post: (id: string): Post | null => null,
    posts: (filter: {status?: PostStatus; tag?: string; limit?: number}): Post[] => [],
    search: (query: string): SearchResult[] => [],
    feed: async (): Promise<Post[]> => []
  },
  Mutation: {
    createPost: (input: {
      title: string
      body: string
      tags: string[]
      status?: PostStatus
    }): Post => ({}) as Post,
    addComment: (postId: string, input: {body: string}): Comment => ({}) as Comment,
    publishPosts: (ids: string[]): Post[] => []
  }
}
