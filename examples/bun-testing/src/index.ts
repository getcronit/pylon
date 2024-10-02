import {app} from '@getcronit/pylon'

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

export const graphql = {
  Query: {
    posts
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

app.get('/posts', c => {
  return c.json(posts)
})

app.post('/posts', async c => {
  let body: FormData
  try {
    body = await c.req.formData()
  } catch (e) {
    return new Response('Invalid form data', {
      status: 400
    })
  }

  const title = body.get('title')?.toString()
  const content = body.get('content')?.toString()

  if (!title || !content) {
    return new Response('Title and content are required', {
      status: 400
    })
  }

  const post = {
    id: posts.length + 1,
    title,
    content
  }

  posts.push(post)

  return c.json(post, 201, {
    'X-Custom': 'Thanks for creating!'
  })
})

export default app
