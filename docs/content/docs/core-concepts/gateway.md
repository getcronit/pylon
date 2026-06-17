---
title: Gateway & Remote Schemas
description: Consume other GraphQL APIs as typed delegate calls and stitch them into your own schema.
section: Core Concepts
order: 6
---

The gateway lets a Pylon app **consume other GraphQL APIs as part of its own
schema**. You generate strongly typed bindings from a remote schema with
`pylon pull`, then `delegate` to remote operations from your resolvers —
forwarding the request's auth, requesting only the fields you need, and reshaping
the response. To the client it's all one API.

It composes with the rest of Pylon: a single object can have fields from your
**types** (the compiler), your **data** (the ORM), and a **remote service** (the
gateway) — resolved in one request, all type-checked.

## When to use it

- **Backend-for-frontend (BFF).** Give your frontend one graph that stitches
  together several internal GraphQL services, so the client makes one query
  instead of N.
- **Wrap a third-party GraphQL API.** Front Shopify, GitHub, a headless CMS, etc.
  with your own schema — add auth, computed fields, and pricing logic on top,
  and keep the upstream API key server-side.
- **Incremental migration (strangler-fig).** Rebuilding a legacy GraphQL service
  in Pylon? New fields are native resolvers; not-yet-migrated fields `delegate`
  to the old service. The client sees one stable schema the whole way; you move
  fields over and delete the delegation when done.
- **Policy in front of a shared service.** Put your `gate`/abilities and tenancy
  in one place, then forward the request to an internal service that does no
  authz of its own.

## Pull the remote schema

```bash
pylon pull https://api.example.com/graphql -n example -o ./src/generated
```

This writes a typed registry you import when configuring the gateway. Re-run it
when the remote schema changes — usage that no longer fits surfaces as a
TypeScript error.

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

`headers` receives the current request context, so you can forward auth (or any
header) to the upstream on a per-request basis.

## Delegate from a resolver

`delegate` takes the remote operation key (`Operation.field`) and a `needs`
selection — only those fields are requested from, and returned by, the remote
API (no overfetching):

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

## Stitch local + remote into one type

Delegation isn't limited to top-level resolvers — a field on your own model can
resolve from a remote service. Here `Order` is stored in your database, but its
`customer` comes from a remote users service, merged into a single result:

```ts title="src/index.ts"
class Order extends models.Model {
  static objects = db.manager(Order)
  id = models.ID()
  customerId = models.Text()
  total = models.Int()

  // computed field → delegates to the remote users service
  customer() {
    return gateway.delegate('Query.user', {
      args: {id: this.customerId},
      needs: {name: true, email: true}
    })
  }
}
```

A client query like `{ orders { total customer { name email } } }` resolves
`orders` from Postgres and `customer` from the remote service in one round-trip —
with the auth header forwarded and only `name`/`email` fetched upstream.

## Patches

`patches` transform a remote type's response after it's fetched — for adding
computed fields or reshaping data, keyed by the remote type name:

```ts
const gateway = createGateway<ExampleRegistry>().configure({
  url: 'https://api.example.com/graphql',
  headers: ctx => ({authorization: ctx.req.header('authorization') ?? ''}),
  patches: {
    User: user => ({...user, fullName: `${user.firstName} ${user.lastName}`})
  }
})
```

Fields the caller selected are always preserved, even if a patch returns a
partial object — so a patch can only *add to or override* the remote data, never
accidentally drop a requested field.
