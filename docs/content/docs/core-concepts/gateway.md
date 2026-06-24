---
title: Gateway
nav: Gateway
description: Stitch remote GraphQL APIs into your schema — delegate fields, enrich remote types, and keep everything typed.
section: Core Concepts
order: 7
---

Your app rarely owns all its data. The gateway lets you fold a remote GraphQL API
into your own schema — calling out to it for some fields, enriching its types with
your own, and keeping the whole surface type-safe. **A delegated field looks local
to your clients; the remote call is an implementation detail.**

## Generate a typed registry

Point `pylon pull` at a remote GraphQL endpoint and it generates a typed registry
describing that API — the operations you can delegate to and the types they return.

```bash
pylon pull http://localhost:4901/graphql
```

This writes a registry module you import as a type. `createGateway<Registry>()` then
gives you a fully typed gateway client.

## Delegate a field

`configure` binds a gateway to a URL; `delegate` calls a remote operation. The
`needs` object declares exactly which remote fields to request, and the result is
typed from the registry:

```ts title="src/index.ts"
import {Pylon, createGateway} from '@getcronit/pylon'
import type {RemoteRegistry as UsersRegistry} from './generated/users'

const users = createGateway<UsersRegistry>().configure({
  url: process.env.REMOTE_URL ?? 'http://localhost:4901/graphql',
  // forward the caller's auth to the remote
  headers: ctx => ({authorization: ctx?.req?.header('authorization') ?? ''})
})

export default new Pylon({
  graphql: {
    Query: {
      user: (id: string) =>
        users.delegate('Query.user', {
          args: {id},
          needs: {id: true, email: true, firstName: true, lastName: true}
        })
    }
  }
})
```

The delegate key is `'Operation.field'` (`'Query.user'`). `args` are the remote
operation's arguments; `needs` is the selection set sent to the remote — request
only what you'll use.

## Enrich remote types with patches

`patches` rewrite a remote type as it flows through the gateway: add a computed
field, override one, or omit one. A patch receives the remote object and returns the
shape your schema exposes. Here a `User` gains a computed `fullName` and a lazily
delegated `org` from a *second* remote service:

```ts title="src/index.ts"
import {Pylon, createGateway} from '@getcronit/pylon'
import type {RemoteRegistry as UsersRegistry} from './generated/users'
import type {RemoteRegistry as OrgsRegistry} from './generated/orgs'

const fwd = (ctx: any) => ({authorization: ctx?.req?.header('authorization') ?? ''})

const orgs = createGateway<OrgsRegistry>().configure({
  url: process.env.ORGS_URL ?? 'http://localhost:4904/graphql',
  headers: fwd
})

const users = createGateway<UsersRegistry>().configure({
  url: process.env.REMOTE_URL ?? 'http://localhost:4901/graphql',
  headers: fwd,
  patches: {
    User: u => ({
      ...u,
      fullName: `${u.firstName} ${u.lastName}`,
      // delegate to the OTHER service, lazily, only when `org` is selected
      org: () => orgs.delegate('Query.org', {args: {id: u.orgId}, needs: {id: true, name: true}})
    })
  }
})

export default new Pylon({
  graphql: {
    Query: {
      fullUser: (id: string) =>
        users.delegate('Query.user', {
          args: {id},
          needs: {id: true, email: true, firstName: true, lastName: true, orgId: true}
        })
    }
  }
})
```

A patch that adds a field must declare the source data it depends on in `needs`
(here `firstName`, `lastName`, and `orgId`), so the gateway requests it from the
remote even when the client didn't ask for it directly.

## Polymorphic types across services

Interfaces and unions stitch cleanly too. A patch sets `__typename` on the remote
object, and Pylon resolves the concrete member from it — no separate variant
configuration is needed. Combined with [interfaces &
unions](/docs/core-concepts/interfaces-unions), a remote polymorphic type becomes a
first-class part of your local schema.

:::tip
Forward the incoming `authorization` header through `headers` so the remote enforces
the caller's permissions — the gateway should pass identity through, not replace it.
:::

:::tip[Related guide]
Stitch a real remote service step by step in [Federating a Remote API](/docs/guides/federating-apis).
:::
