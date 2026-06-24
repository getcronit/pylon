---
title: Realtime with Subscriptions
nav: Realtime
description: Build a live feed — publish from a mutation, fan out over a pub/sub, and stream events to subscribed clients.
section: Guides
order: 3
---

A live feed needs three pieces: a place to publish events, a mutation that
publishes one, and a subscription that streams them to whoever is listening. In
Pylon a `Subscription` resolver is just **a function that returns an async
iterator** — there's no new abstraction. This guide builds a chat-style feed where
posting a message pushes it to every subscribed client in real time.

## 1. Create a pub/sub channel

Events produced in one request — a mutation — need to reach subscribers waiting in
other requests. A pub/sub channel fans them out. Pylon re-exports
`experimentalCreatePubSub` from the package entry point. Type it by topic so
`publish` and `subscribe` stay checked:

```ts title="src/index.ts"
import {experimentalCreatePubSub} from '@getcronit/pylon'

class Message {
  id!: string
  channel!: string
  text!: string
}

const pubSub = experimentalCreatePubSub<{
  messageAdded: [channel: string, payload: Message]
}>()
```

The topic `messageAdded` is keyed by `channel`, so a subscriber to one channel
never sees another channel's traffic.

## 2. Publish from a mutation

The mutation does the write, then publishes the result on the channel's topic and
key. Subscribers keyed to that channel get it next:

```ts title="src/index.ts"
import {Pylon, experimentalCreatePubSub} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Mutation: {
      sendMessage: (channel: string, text: string): Message => {
        const message = {id: crypto.randomUUID(), channel, text}
        pubSub.publish('messageAdded', channel, message)
        return message
      }
    },
    Subscription: {
      // returns the iterator from pubSub.subscribe — every matching publish yields one event
      messageAdded: (channel: string): AsyncIterable<Message> =>
        pubSub.subscribe('messageAdded', channel)
    }
  }
})
```

The subscription resolver returns the iterator directly. Each `publish` with the
matching topic and key delivers one event to subscribed clients. The yielded
type — `Message` — becomes the field type in the generated schema:

```graphql title="Pylon generates"
type Subscription {
  messageAdded(channel: String!): Message!
}
```

## 3. Subscribe from a client

A client opens the subscription and renders each event as it arrives. Over the
GraphQL wire it's an ordinary subscription operation:

```graphql title="The client operation"
subscription ($channel: String!) {
  messageAdded(channel: $channel) {
    id
    text
  }
}
```

Send a `sendMessage` mutation on `channel: "general"` from one tab and every
client subscribed to `"general"` receives the new message instantly — no polling,
no refetch.

## Async generators for derived streams

When you produce values yourself rather than fan out external events, write the
resolver as an async generator. Its yielded type becomes the field type:

```ts
import {Pylon} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Subscription: {
      countdown: async function* (from: number): AsyncGenerator<number> {
        for (let i = from; i >= 0; i--) {
          yield i
          await new Promise(r => setTimeout(r, 1000))
        }
      }
    }
  }
})
```

:::note
`experimentalCreatePubSub` backs the channel with an in-process event source —
fine for a single instance. For a multi-instance deployment, back the pub/sub with
a shared transport (e.g. Redis) so events reach every node.
:::

The full mechanics — async iterators, fan-out, and the generated schema — live in
[Subscriptions](/docs/core-concepts/subscriptions).
