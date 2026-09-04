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

## Constrain what a delegated field returns

Patches control **fields**. They run on the *result*, so on their own they do not
control the **arguments** a client may send, nor the types a selection can reach
through a patched field. That is fine when the gateway forwards the caller's
identity and the remote enforces permissions. It matters when the gateway
authenticates with a fixed service credential — then your configuration *is* the
boundary, and two things are open by default.

### Restrict and force arguments with `pass`

A filter applied in one resolver does not apply to the same rows reached through
another field. If `Query.products` constrains what is visible, a nested
`ProductCollection.products` still reaches the remote with whatever the client
sent:

```graphql
{ productCollections { products(query: "status:DRAFT") { nodes { title } } } }
```

`pass` attaches an argument policy to a patch:

```ts title="src/index.ts"
import {createGateway, pass} from '@getcronit/pylon'

const catalogue = createGateway<CatalogueRegistry>().configure({
  url: process.env.CATALOGUE_URL!,
  patches: {
    ProductCollection: pass(
      c => ({handle: c.handle, name: c.name, products: c.products}),
      {
        products: {
          args: ['first', 'last', 'after', 'before', 'skip'],
          force: {query: 'status:ACTIVE published:true'}
        }
      }
    )
  }
})
```

- **`force`** is applied to the outgoing request. It is a constraint, not a
  default — and a client may **not** supply a forced argument. The value could
  only ever be discarded, and handing back the constrained set as though their
  filter had applied is exactly the failure this removes.
- **`args`** is an allowlist. An argument outside it is rejected — so an argument
  the remote adds *later* is denied by default, the same rule fields already
  follow. Omit `args` to allow everything and only force.
- `force` and `args` are disjoint: `args` is what a client may set, `force` is
  what the gateway sets. Setting a forced argument is refused with
  `GATEWAY_ARGUMENT_FORCED`, one outside the allowlist with
  `GATEWAY_ARGUMENT_NOT_ALLOWED`.

The type name comes from the patch's own key, so it is never repeated. Values are
constants, or `(ctx) => value` for per-request ones:

```ts
{orders: {force: {tenantId: ctx => ctx.get('tenantId')}}}
```

Because the arguments travel in the same request, the nested selection is still
one round trip. A hand-written patch function that re-delegates from the root
instead costs a call per row, and re-implements whatever the nested field meant.

Root fields need nothing here: a delegated root field is called from your own
resolver, which already decides its arguments.

:::note
`args` is enforced on the request, not carved out of the SDL — a denied argument
is still advertised by the schema and fails when used. Removing it from the
published schema needs the schema builder to filter arguments by name, which is
tracked separately.
:::

### Decide with a field you do not expose — `guard`

The usual reason to fetch a field you never publish is to make a decision with
it. `guard` receives exactly what `needs` selected, and turns a rejection into
`null`:

```ts title="src/index.ts"
product: (handle: string) =>
  catalogue.delegate('Query.product', {
    args: {handle},
    needs: {status: true, isPublished: true},
    guard: r => r.status === 'ACTIVE' && r.isPublished
  })
```

`r` is typed from `needs`, so removing an entry from `needs` breaks the guard at
compile time instead of silently disabling it. The **returned** type is
unchanged — the guard's fields never join it, which is what keeps them out of
your published schema.

### Fail closed on unpatched types

A type reachable through a patched field but not itself patched is exposed in
full, and grows as the remote adds fields to it. `strict` turns that omission
into an error:

```ts title="src/index.ts"
import {createGateway, passthrough} from '@getcronit/pylon'

createGateway<Registry>().configure({
  url,
  strict: true,
  patches: {
    Product: p => ({id: p.id, title: p.title, price: p.price}),
    // `Money` is deliberately transparent — say so, rather than leaving it out
    Money: passthrough()
  }
})
```

Under `strict`, delegating a selection that reaches a type with no patch fails
and names the type. It is off by default: switching it on removes types an
existing gateway is already serving, which is the point, but it is a breaking
change to adopt.

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
