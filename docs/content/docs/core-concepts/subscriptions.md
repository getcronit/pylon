---
title: Subscriptions
description: Real-time GraphQL subscriptions backed by a typed pub/sub.
section: Core Concepts
order: 5
---

Add a `Subscription` member to your `graphql` object to push real-time updates to
clients. Pylon provides a typed pub/sub via `experimentalCreatePubSub`.

```ts
import {Pylon, experimentalCreatePubSub, ID} from '@getcronit/pylon'
import {randomUUID} from 'crypto'

enum Events {
  postCreated = 'postCreated'
}

const pubSub = experimentalCreatePubSub<{
  [Events.postCreated]: [post: Post]
}>()

class Post {
  constructor(
    public id: ID,
    public title: string,
    public content: string
  ) {}

  static create = (title: string, content: string) => {
    const post = new Post(randomUUID(), title, content)
    pubSub.publish(Events.postCreated, post) // notify subscribers
    return post
  }
}

export default new Pylon({
  graphql: {
    Query: {
      posts: (): Post[] => []
    },
    Mutation: {
      createPost: Post.create
    },
    Subscription: {
      postCreated: () => pubSub.subscribe(Events.postCreated)
    }
  }
})
```

A subscription resolver returns the async iterator from `pubSub.subscribe(event)`;
each `pubSub.publish(event, payload)` delivers the payload to every subscriber.
The pub/sub map is typed, so publish and subscribe stay type-checked end to end.

:::warning
Subscriptions require a long-lived connection. They run on Node and Bun;
serverless/edge runtimes that don't keep connections open are not suitable for
subscription transports.
:::
