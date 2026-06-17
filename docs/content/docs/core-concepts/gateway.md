---
title: Gateway & Remote Schemas
description: Pull a remote GraphQL schema into typed delegate calls and compose it into your API.
section: Core Concepts
order: 6
---

Pylon can consume other GraphQL APIs as a typed gateway. You generate strongly
typed bindings from a remote schema with `pylon pull`, then delegate to remote
operations from your own resolvers — requesting exactly the fields you need.

## Pull the remote schema

```bash
pylon pull https://api.example.com/graphql -n example -o ./src/generated
```

This writes a typed registry you import when configuring the gateway.

## Configure a gateway

```ts
import {createGateway} from '@getcronit/pylon'
import type {ExampleRegistry} from './generated/example'

const gateway = createGateway<ExampleRegistry>().configure({
  url: 'https://api.example.com/graphql',
  headers: ctx => ({
    authorization: ctx.req.header('authorization') ?? ''
  })
})
```

`headers` receives the current request context, so you can forward auth on a
per-request basis.

## Delegate from a resolver

`delegate` takes the remote operation and a `needs` selection — only those fields
are requested from, and returned by, the remote API:

```ts
export default new Pylon({
  graphql: {
    Query: {
      remoteUser: (id: string) =>
        gateway.delegate('Query.user', {
          args: {id},
          needs: {
            id: true,
            email: true,
            profile: {firstName: true, lastName: true}
          }
        })
    }
  }
})
```

Because the registry is generated from the remote schema, the operation key, its
arguments, and the `needs` selection are all type-checked — a remote schema
change that breaks your usage shows up as a TypeScript error after the next
`pylon pull`.
