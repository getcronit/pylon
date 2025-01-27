import {app, auth, PylonConfig, useAuth, usePages} from '@getcronit/pylon'

// Classes
class Author {
  constructor(public id: number, public name: string, public email: string) {}
}

class Post {
  constructor(
    public id: number,
    public title: string,
    public content: string,
    public author: Author,
    public tags: string[]
  ) {}
}

class User {
  constructor(
    public id: number,
    public name: string,
    public email: string,
    public posts: Post[]
  ) {}
}

// Instances
const authors = {
  1: new Author(1, "Alice", "alice@example.com"),
  2: new Author(2, "Bob", "bob@example.com"),
  3: new Author(3, "Charlie", "charlie@example.com"),
};

const posts = [
  new Post(1, "Foo", "This is the content of the first post.", authors[1], [
    "GraphQL",
    "TypeScript",
  ]),
  new Post(2, "Bar", "This is the content of the second post.", authors[2], [
    "JavaScript",
    "API",
  ]),
];


// GraphQL schema
export const graphql = {
  Query: {
    posts,
    users:  [new User(1, "Alice", "alice@example.com", posts.filter((p) => p.author.id === 1)),
      new User(2, "Bob", "bob@test.com", posts.filter((p) => p.author.id === 2)),
    ],
  },
};


export const config: PylonConfig = {
  plugins: [
    // useAuth({
    //   issuer: 'https://accounts2.cronit.io'
    // }),
    usePages({})
  ]
}

export default app
