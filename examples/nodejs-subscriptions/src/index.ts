import {app, experimentalCreatePubSub, ID} from '@getcronit/pylon'
import {serve} from '@hono/node-server'
import {randomUUID} from 'crypto'

enum Events {
  postCreated = 'postCreated'
}

const pubSub = experimentalCreatePubSub<{
  [Events.postCreated]: [post: Post]
}>()

class Post {
  static create = (title: string, content: string) => {
    const post = new Post(randomUUID(), title, content)
    posts.push(post)
    pubSub.publish(Events.postCreated, post)
    return post
  }

  constructor(public id: ID, public title: string, public content: string) {}
}

const posts = [
  new Post(randomUUID(), 'Hello, world!', 'This is the first post'),
  new Post(randomUUID(), 'Hello, world!', 'This is the second post')
]

export const graphql = {
  Query: {
    posts
  },
  Mutation: {
    createPost: Post.create
  },
  Subscription: {
    postCreated: () => pubSub.subscribe(Events.postCreated)
  }
}

serve({
  fetch: app.fetch,
  port: 3100
}, info => {
  console.log(`Server running at ${info.port}`)
})
