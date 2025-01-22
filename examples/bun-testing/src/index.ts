import {app, auth, PylonConfig, useAuth, usePages} from '@getcronit/pylon'

const posts = [
  {
    id: 1,
    title: 'Hello, world!',
    content: 'This is the first post'
  },
  {
    id: 2,
    title: 'Hello, world!',
    content: 'This is the second post'
  }
]

app.get('/test', c => {
  console.log('test')

  return c.json(c.get('auth'))
})

export const graphql = {
  Query: {
    posts,
    lazy: async () => {
      await new Promise(resolve => setTimeout(resolve, 2000))

      return 'lazy'
    }
  },
  Mutation: {
    createPost: (title: string, content: string) => {
      const post = {
        id: posts.length + 1,
        title,
        content
      }

      posts.push(post)

      return post
    }
  }
}

export const config: PylonConfig = {
  plugins: [
    useAuth({
      issuer: 'https://accounts2.cronit.io'
    }),
    usePages({})
  ]
}

export default app
