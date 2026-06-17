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

A patch's return shape is **authoritative for the schema**: a field you add in a
patch (like `fullName`) becomes a real field of that type, queryable by clients.

The patch result is merged *over* the fetched data (`{...fetched, ...patched}`),
so top-level fields you simply **omit** are preserved — returning a partial object
won't drop a requested field by accident. But the merge is **shallow**, and it
*does* let you override: returning a field explicitly (including to `null`), or
returning a partial **nested** object, replaces that value wholesale and can drop
sub-fields. So a patch can change or remove data — just not silently by leaving a
top-level field out.

A patch runs **after** the remote row is fetched, so it sees real data — you can
branch on the row's values. If a computed field needs a column the client didn't
select, list it in `needs`: `needs` is *additive* (client selection ∪ `needs`),
so the underlying fields are fetched upstream even when the client only asks for
the computed one.

### Add a field that delegates to another service

A patch is synchronous, but a field's value can be a **function** — GraphQL
invokes it (and awaits the result) only when that field is selected. That lets a
patch attach a *lazy* field that delegates to a **second** service through its own
gateway:

```ts
// gateway #2 → a separate orgs service
const orgs = createGateway<OrgsRegistry>().configure({url: process.env.ORGS_URL!})

const users = createGateway<UsersRegistry>().configure({
  url: process.env.USERS_URL!,
  patches: {
    User: u => ({
      ...u,
      // resolved lazily — only when `org` is selected, and only then is the
      // orgs service called
      org: () => orgs.delegate('Query.org', {args: {id: u.orgId}, needs: {id: true, name: true}})
    })
  }
})
```

`{ user(id: "u1") { email org { name } } }` now resolves `email` from the users
service and `org` from the orgs service — composed in your schema, fetched only
on demand. A gateway with no `patches` (like `orgs` here) is a valid pure
pass-through.

## Turn a remote type into a polymorphic interface

A remote service often exposes a single **flat** type with a discriminator —
`User { kind: "doctor" | "patient", specialty, insuranceId }`. You can present it
to your clients as a proper GraphQL **interface** with variant members, without
any federation directives or a new config — just a class hierarchy plus a patch
that stamps `__typename`.

Declare the interface as a base class with subclasses (Pylon's normal convention
— a returned base type with subclasses emits an interface), then discriminate in
the patch:

```ts title="src/index.ts"
import {Pylon, createGateway} from '@getcronit/pylon'
import type {RemoteRegistry as UsersRegistry} from './generated/users'

// base class → interface; subclasses → members
export class Profile {
  id!: string
  email!: string
}
export class DoctorProfile extends Profile {
  specialty!: string
}
export class PatientProfile extends Profile {
  insuranceId!: string
}

const users = createGateway<UsersRegistry>().configure({
  url: process.env.USERS_URL!,
  patches: {
    // discriminate on the row, stamp the member __typename + project its fields
    User: u =>
      u.kind === 'doctor'
        ? {__typename: 'DoctorProfile', id: u.id, email: u.email, specialty: u.specialty}
        : {__typename: 'PatientProfile', id: u.id, email: u.email, insuranceId: u.insuranceId}
  }
})

export default new Pylon({
  graphql: {
    Query: {
      // Annotate the return as the interface (wrapped in `Promise`, since delegate
      // is async). The annotation is what collapses the delegate's inferred variant
      // union into your declared interface — no cast needed.
      profile: (id: string): Promise<Profile | null> =>
        users.delegate('Query.user', {
          args: {id},
          needs: {id: true, email: true, kind: true, specialty: true, insuranceId: true}
        })
    }
  }
})
```

Clients query it like any interface:

```graphql
{
  profile(id: "u1") {
    __typename
    ... on DoctorProfile { specialty }
    ... on PatientProfile { insuranceId }
  }
}
```

How the two halves line up:

- **Schema (build time)** comes entirely from the classes. `Profile` + its
  subclasses emit a `Profile` interface whose members are `DoctorProfile` /
  `PatientProfile`, and `profile` is typed as that interface. The patch's runtime
  branching plays no part in the schema.
- **Runtime** runs the patch on each fetched row, stamps `__typename`, and the
  gateway resolves the matching fragment. The variant fields are already present
  because `needs` requested them.

The types line up by inference: `delegate` returns `Promise<DoctorProfile |
PatientProfile>` (the discriminated union of your patch's branches), which is
assignable to `Promise<Profile | null>` directly — no cast.

> **Annotate the interface — don't rely on pure inference.** The return
> annotation (`Promise<Profile | null>`) is what tells the compiler to expose the
> field as your `Profile` interface. If you drop it and let the type be inferred,
> the compiler emits the variant union as *anonymous* object types that collide
> with your declared classes and produces an **invalid schema**. So: declare the
> interface + members as classes, and annotate the resolver with the interface.

> **Gotcha.** The mapping *into* a member is not type-checked: nothing verifies
> that a branch stamping `__typename: 'DoctorProfile'` returns a shape matching
> `DoctorProfile`. A typo'd `__typename` or a missing variant field surfaces at
> runtime, not at build. Stamp a `__typename` that exactly matches a declared
> member, and keep `needs` in sync with the fields your variants project.
