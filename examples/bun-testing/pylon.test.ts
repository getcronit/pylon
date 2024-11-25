import {describe, expect, test} from 'bun:test'

// Make sure to run `bun run build` before running this test
import {handler} from '@getcronit/pylon'

import app, {graphql} from './src/index'

app.use(handler({graphql}))

describe('GraphQL API', () => {
  test('Query.hello', async () => {
    const res = await app.request('/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: 'query { posts { id title content } }'
      })
    })
    expect(res.status).toBe(200)
    expect(await res.json<object>()).toEqual({
      data: {
        posts: [
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
      }
    })
  })

  test('Mutation.createPost', async () => {
    const res = await app.request('/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query:
          'mutation { createPost(title: "Hello, world!", content: "This is the third post") { id title content } }'
      })
    })
    expect(res.status).toBe(200)
    expect(await res.json<object>()).toEqual({
      data: {
        createPost: {
          id: 3,
          title: 'Hello, world!',
          content: 'This is the third post'
        }
      }
    })
  })
})

describe('Routes', () => {
  test('GET /posts', async () => {
    const res = await app.request('/posts')
    expect(res.status).toBe(200)
    expect(await res.json<object>()).toEqual([
      {
        id: 1,
        title: 'Hello, world!',
        content: 'This is the first post'
      },
      {
        id: 2,
        title: 'Hello, world!',
        content: 'This is the second post'
      },
      {
        id: 3,
        title: 'Hello, world!',
        content: 'This is the third post'
      }
    ])
  })
  test('POST /posts', async () => {
    const res = await app.request('/posts', {
      method: 'POST',
      body: new URLSearchParams({
        title: 'Hello, world!',
        content: 'This is the fourth post'
      })
    })
    expect(res.status).toBe(201)
    expect(await res.json<object>()).toEqual({
      id: 4,
      title: 'Hello, world!',
      content: 'This is the fourth post'
    })
    expect(res.headers.get('X-Custom')).toBe('Thanks for creating!')
  })

  test('GET /posts and check if the new post is there', async () => {
    const res = await app.request('/posts')
    expect(res.status).toBe(200)
    expect(await res.json<object>()).toEqual([
      {
        id: 1,
        title: 'Hello, world!',
        content: 'This is the first post'
      },
      {
        id: 2,
        title: 'Hello, world!',
        content: 'This is the second post'
      },
      {
        id: 3,
        title: 'Hello, world!',
        content: 'This is the third post'
      },
      {
        id: 4,
        title: 'Hello, world!',
        content: 'This is the fourth post'
      }
    ])
  })

  test('POST /posts with missing title', async () => {
    const res = await app.request('/posts', {
      method: 'POST',
      body: new URLSearchParams({
        content: 'This is the fourth post'
      })
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Title and content are required')
  })

  test('POST /posts with missing content', async () => {
    const res = await app.request('/posts', {
      method: 'POST',
      body: new URLSearchParams({
        title: 'Hello, world!'
      })
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Title and content are required')
  })

  test('POST /posts with missing title and content', async () => {
    const res = await app.request('/posts', {
      method: 'POST',
      body: new URLSearchParams({})
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Title and content are required')
  })

  test('POST /posts with invalid Content-Type', async () => {
    const res = await app.request('/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Hello, world!',
        content: 'This is the fifth post'
      })
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Invalid form data')
  })
})
