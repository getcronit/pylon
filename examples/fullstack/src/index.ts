import {app, auth, getContext, PylonConfig, useAuth, usePages} from '@getcronit/pylon'

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


const users = [new User(1, "Alice", "alice@example.com", posts.filter((p) => p.author.id === 1)),
  new User(2, "Bob", "bob@test.com", posts.filter((p) => p.author.id === 2)),
]

const products = [
  {
    id: 1,
    name: "Luftballon-Set 'Party Mix'",
    description: "100 bunte Luftballons in verschiedenen Größen und Farben",
    price: 19.99,
    image: "/placeholder.svg?height=300&width=300"
  },
  {
    id: 2,
    name: "Helium-Tank",
    description: "Tragbarer Helium-Tank für bis zu 50 Ballons",
    price: 490.99,
    image: "/placeholder.svg?height=300&width=300"
  },
  {
    id: 3,
    name: "Folienballon 'Happy Birthday'",
    description: "Großer Folienballon mit 'Happy Birthday' Schriftzug",
    price: 9.99,
    image: "/placeholder.svg?height=300&width=300"
  },
  {
    id: 4,
    name: "Ballon-Girlande 'Regenbogen'",
    description: "Fertige Ballon-Girlande in Regenbogenfarben",
    price: 29.99,
    image: "/placeholder.svg?height=300&width=300"
  },
  {
    id: 5,
    name: "Konfetti-Ballons",
    description: "Set mit 20 transparenten Ballons gefüllt mit buntem Konfetti",
    price: 14.99,
    image: "/placeholder.svg?height=300&width=300"
  },
  {
    id: 6,
    name: "LED-Ballons",
    description: "10 leuchtende LED-Ballons für besondere Effekte",
    price: 24.99,
    image: "/placeholder.svg?height=300&width=300"
  }
]

const instagramPosts = [
  {
    id: '1',
    media_url: 'https://via.placeholder.com/300',
    permalink: 'https://www.instagram.com/p/1',
    caption: 'This is a dummy caption for post 1'
  },
  {
    id: '2',
    media_url: 'https://via.placeholder.com/300',
    permalink: 'https://www.instagram.com/p/2',
    caption: 'This is a dummy caption for post 2'
  },
  {
    id: '3',
    media_url: 'https://via.placeholder.com/300',
    permalink: 'https://www.instagram.com/p/3',
    caption: 'This is a dummy caption for post 3'
  },
  {
    id: '4',
    media_url: 'https://via.placeholder.com/300',
    permalink: 'https://www.instagram.com/p/4',
    caption: 'This is a dummy caption for post 4'
  },
  {
    id: '5',
    media_url: 'https://via.placeholder.com/300',
    permalink: 'https://www.instagram.com/p/5',
    caption: 'This is a dummy caption for post 5'
  },
  {
    id: '6',
    media_url: 'https://via.placeholder.com/300',
    permalink: 'https://www.instagram.com/p/6',
    caption: 'This is a dummy caption for post 6'
  }
]


import {
  getCookie,
  getSignedCookie,
  setCookie,
  setSignedCookie,
  deleteCookie,
} from 'hono/cookie'

// GraphQL schema
export const graphql = {
  Query: {
    posts,
    users: (take: number) => users.slice(0, take),
    products,
    instagramPosts
  },
  Mutation: {
    testSetHeader: (key: string, value: string) => {
      const ctx = getContext();

      ctx.header(key, value);

      ctx.res.headers.append("X-Test-Header", "Hello, World!2");

      setCookie(ctx, "test", "value", {
        httpOnly: true,
        secure: true,
        sameSite: "strict"
      });

      return true;
    }
  }
};

app.get("/header", async c => {
  c.header("X-Custom-Header", "Hello, World!");

  setCookie(c, "test", "value", {
    httpOnly: true,
    secure: true,
    sameSite: "strict"
  });

  return c.json({ message: "Header set!" });
})


export const config: PylonConfig = {
  plugins: [
    // useAuth({
    //   issuer: 'https://accounts2.cronit.io'
    // }),
    usePages({})
  ]
}

export default app
