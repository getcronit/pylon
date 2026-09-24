import {buildSchema} from 'graphql'

/**
 * One fixed schema exercising the GraphQL features the analyzer must reason about:
 * scalars & enums (leaves), nested objects, object lists and scalar lists, field
 * arguments, a Relay-style connection (edges/node/pageInfo), an interface, and a
 * union. All structured analyzer tests trace against this — list-ness and field
 * validity come from here, not from structural guessing.
 */
export const SDL = /* GraphQL */ `
  type Query {
    me: User
    user(id: ID!): User
    users: [User!]!
    post(id: ID!): Post
    posts(first: Int, after: String): PostConnection!
    organization: Organization
    search(term: String!): [SearchResult!]!
    node(id: ID!): Node
  }

  type Mutation {
    createUser(name: String!): User
    publishPost(id: ID!): Post
  }

  interface Node {
    id: ID!
  }

  enum Role {
    ADMIN
    USER
    GUEST
  }

  type User implements Node {
    id: ID!
    name: String
    email: String
    avatarUrl: String
    role: Role
    permissions: [String!]!
    profile: Profile
    posts: [Post!]!
    friends: [User!]!
    manager: User
  }

  type Profile {
    bio: String
    address: Address
  }

  type Address {
    city: String
    country: String
  }

  type Post implements Node {
    id: ID!
    title: String
    body: String
    published: Boolean
    tags: [String!]!
    author: User!
    comments: [Comment!]!
    related(first: Int, after: String): PostConnection!
  }

  type Comment {
    id: ID!
    text: String
    author: User!
  }

  type PostConnection {
    edges: [PostEdge!]!
    pageInfo: PageInfo!
    totalCount: Int
  }

  type PostEdge {
    cursor: String!
    node: Post!
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  type Organization {
    name: String
    departments: [Department!]!
  }

  type Department {
    name: String
    teams: [Team!]!
  }

  type Team {
    name: String
    active: Boolean
    leader: User
  }

  union SearchResult = User | Post
`

export const schema = buildSchema(SDL)
