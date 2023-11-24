import {defineService, withContext} from '@snek-at/function'

const userMe = withContext(context => () => {
  // check if auth header is set
  if (!context.req.headers.authorization) {
    throw new Error('Not authorized')
  }

  const user = new User(1, 'John Doe')

  return user
})

class Blog {
  id: number
  title: string
  content: string

  constructor(id: number, title: string, content: string) {
    this.id = id
    this.title = title
    this.content = content
  }
}

class User {
  id: number
  name: string

  constructor(id: number, name: string) {
    this.id = id
    this.name = name
  }

  blogs = (total: number) => {
    const items: Blog[] = []

    for (let i = 0; i < total; i++) {
      items.push(new Blog(i, `Blog ${i}`, `Content ${i}`))
    }

    return items
  }
}

interface CircleInput {
  radius: number
}

export default defineService(
  {
    Query: {
      hello: () => 'Hello world!',
      userMe,
      calculate: (a: number, b: number, operation: string) => {
        switch (operation) {
          case '+':
            return a + b
          case '-':
            return a - b
          case '*':
            return a * b
          case '/':
            return a / b
          default:
            return 0
        }
      }
    },
    Mutation: {
      updateSomething: () => 'Hello world!',
      inlineObject: (input: {name: string; age: number}) => {
        return input
      },
      getGirlfriend: (input: {name: string}) => {
        const girls = [
          {
            name: 'Leia',
            age: 19
          },
          {
            name: 'Padme',
            age: 19
          },
          {
            name: 'Rey',
            age: 19
          },
          {
            name: 'Coco',
            age: 21
          }
        ]

        const filteredGirls = girls.filter(g => g.name == input.name)

        return filteredGirls
      },
      getCircle: (input: CircleInput) => {
        return {
          radius: input.radius,
          area: Math.PI * input.radius * input.radius
        }
      },
      max: Math.max
    }
  },
  {
    configureApp: app => app
  }
)
