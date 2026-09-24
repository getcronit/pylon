---
title: Subscriptions
nav: Subscriptions
description: Stream live data to clients — a Subscription resolver is a function that returns an async iterator.
section: Core Concepts
order: 6
---

A subscription pushes a stream of values to a client over time. In Pylon there is no
new abstraction to learn: **a `Subscription` resolver is a function that returns an
async iterator.** Each value the iterator yields is delivered to the subscribed
client as one event.

## A counting subscription

Any async generator works — its yielded type becomes the field type:

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

```graphql title="The generated field"
type Subscription {
  countdown(from: Int!): Int!
}
```

## Fan-out with a pub/sub

For events produced elsewhere — a mutation, a queue, a webhook — fan them out with a
pub/sub channel. Pylon re-exports `experimentalCreatePubSub` from the package entry
point: a mutation publishes, and the subscription iterates the channel.

```ts
import {Pylon, experimentalCreatePubSub} from '@getcronit/pylon'

const pubSub = experimentalCreatePubSub<{
  messageAdded: [channel: string, payload: Message]
}>()

class Message {
  id!: string
  text!: string
}

export default new Pylon({
  graphql: {
    Mutation: {
      sendMessage: (channel: string, text: string): Message => {
        const message = {id: crypto.randomUUID(), text}
        pubSub.publish('messageAdded', channel, message)
        return message
      }
    },
    Subscription: {
      messageAdded: (channel: string): AsyncIterable<Message> =>
        pubSub.subscribe('messageAdded', channel)
    }
  }
})
```

The subscription resolver returns the iterator from `pubSub.subscribe`; every
`publish` with the matching topic and key yields the next value to subscribed
clients.

:::note
`experimentalCreatePubSub` backs the channel with an in-process event source — fine
for a single instance. For a multi-instance deployment, back the pub/sub with a
shared transport (e.g. Redis) so events reach every node.
:::

:::tip[Related guide]
Walk it end to end in [Realtime with Subscriptions](/docs/guides/realtime-subscriptions) — a live feed from publish to subscribed client.
:::
