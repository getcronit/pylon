---
title: Federating a Remote API
nav: Federation
description: Stitch a remote GraphQL service into your schema — delegate fields, enrich its types, and reach across services, all typed.
section: Guides
order: 6
---

Your app rarely owns all its data. A separate users service holds the canonical
profile; you want to expose it on your own schema, enriched with a computed field
and joined to a second service — without your clients knowing any of it is remote.
The gateway does this: it generates a typed registry from the remote, delegates
fields to it, and lets you patch its types. **A delegated field looks local; the
remote call is an implementation detail.**

## 1. Generate a typed registry

Point `pylon pull` at the remote endpoint. It generates a typed registry — the
operations you can delegate to and the types they return:

```bash
pylon pull http://localhost:4901/graphql
```

This writes a registry module you import as a type. `createGateway<Registry>()`
then gives you a fully typed gateway client.

## 2. Delegate a field

`configure` binds a gateway to a URL; `delegate` calls a remote operation. The
`needs` object is the selection set sent to the remote — request only what you'll
use. Forward the caller's auth so the remote enforces their permissions:

```ts title="src/index.ts"
import {Pylon, createGateway} from '@getcronit/pylon'
import type {RemoteRegistry as UsersRegistry} from './generated/users'

const users = createGateway<UsersRegistry>().configure({
  url: process.env.REMOTE_URL ?? 'http://localhost:4901/graphql',
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
operation's arguments; the result is typed from the registry. A client querying
`user(id: "1") { email }` triggers exactly one upstream call.

## 3. Enrich the remote type with a patch

`patches` rewrite a remote type as it flows through the gateway — add a computed
field, override one, or omit one. A patch receives the remote object and returns
the shape your schema exposes. Add a computed `fullName`:

```ts title="src/index.ts"
const users = createGateway<UsersRegistry>().configure({
  url: process.env.REMOTE_URL ?? 'http://localhost:4901/graphql',
  headers: ctx => ({authorization: ctx?.req?.header('authorization') ?? ''}),
  patches: {
    User: u => ({
      ...u,
      fullName: `${u.firstName} ${u.lastName}`
    })
  }
})
```

A patch that adds a field must request the source data it depends on in `needs`
(here `firstName` and `lastName`), so the gateway fetches it from the remote even
when the client only asked for `fullName`:

```ts
users.delegate('Query.user', {
  args: {id},
  needs: {id: true, firstName: true, lastName: true}
})
```

### Decide with a field you never expose

The other reason to fetch a field is to make a decision with it — is this row
visible, does it belong to this tenant — without publishing it. Those fields are
deliberately absent from the type the patch returns, so they are not readable on
the result either. `guard` is where they *are* readable:

```ts title="src/index.ts"
users.delegate('Query.user', {
  args: {id},
  needs: {id: true, firstName: true, lastName: true, status: true},
  guard: u => u.status === 'ACTIVE'   // typed from `needs`
})
```

The guard's argument is typed from `needs`, so deleting an entry breaks the
guard at compile time rather than quietly disabling it. A rejected row resolves
to `null` — "not visible to you" and "does not exist" are the same answer to a
caller who cannot tell the difference — and the returned type is unchanged, which
is what keeps `status` out of your schema.

### The return shape is authoritative

Whatever the patch returns *is* the type Pylon exposes, so the object you build
controls every field:

- **Keep** fields by spreading the remote object through — `{...u}`.
- **Add** or **override** a field by setting it — `fullName`, or
  `email: u.email.toLowerCase()`.
- **Omit** a field by destructuring it out before you spread the rest.

```ts title="src/index.ts"
patches: {
  User: u => {
    const {ssn, ...rest} = u                  // drop ssn — it never reaches your schema
    return {
      ...rest,                                // keep everything else
      fullName: `${u.firstName} ${u.lastName}` // add a computed field
    }
  }
}
```

Because the patch destructures `ssn` out, the generated `User` type simply doesn't
have that field — even though the remote returns it. A bare `u => ({...u})` is the
identity patch: every remote field forwarded unchanged.

:::warning[Authoritative over fields, not over arguments or nested types]
A patch runs on the *result*, so "authoritative" covers the fields of the type it
patches — and stops there:

- **Arguments** on a delegated field still reach the remote as the client sent
  them. A filter you apply in one resolver does not apply to the same data
  reached through another field.
- **A nested type with no patch of its own** is forwarded whole, and gains any
  field the remote adds to it later.

Both are fine when the gateway forwards the caller's identity and the remote
enforces permissions, as this guide does. If it authenticates with a fixed
service credential instead, close them with `pass` and `strict` — see
[Gateway](/docs/core-concepts/gateway#constrain-what-a-delegated-field-returns).
:::

## 4. Reach across services in a patch

A patch can delegate to a *second* remote service, lazily — the cross-service call
fires only when the field is selected. Pull the orgs service and join `org` onto
`User`:

```bash
pylon pull http://localhost:4904/graphql
```

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
      // cross-service delegate, lazy — runs only when `org` is selected
      org: () =>
        orgs.delegate('Query.org', {args: {id: u.orgId}, needs: {id: true, name: true}})
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

A client querying `fullUser(id) { fullName org { name } }` now spans two services
and a computed field — and reads as one local type. The gateway requests `orgId`
from the users service (the patch needs it) and only calls the orgs service
because `org` was selected.

## 5. Map a remote type onto an interface

Polymorphism stitches in without you declaring any types. Say the users service
exposes a single **flat** `User` with a `kind` discriminator, but you want to
present it as a GraphQL **interface** with concrete members. Return a discriminated
union from the patch — stamp each member's `__typename` with `as const` — and the
gateway infers the members, their fields, and the shared interface from the patch
alone. The delegate needs no return annotation:

:::generates
```ts title="You write — src/index.ts"
import {Pylon, createGateway} from '@getcronit/pylon'
import type {RemoteRegistry as UsersRegistry} from './generated/users'

const users = createGateway<UsersRegistry>().configure({
  url: process.env.REMOTE_URL ?? 'http://localhost:4901/graphql',
  patches: {
    // `as const` keeps each __typename a literal — that's what names the members.
    User: u =>
      u.kind === 'doctor'
        ? {__typename: 'DoctorProfile' as const, id: u.id, email: u.email, specialty: u.specialty}
        : {__typename: 'PatientProfile' as const, id: u.id, email: u.email, insuranceId: u.insuranceId}
  }
})

export default new Pylon({
  graphql: {
    Query: {
      // No return annotation — the field type is inferred from the patch's union.
      profile: (id: string) =>
        users.delegate('Query.user', {
          args: {id},
          needs: {id: true, email: true, kind: true, specialty: true, insuranceId: true}
        })
    }
  }
})
```
```graphql title="Pylon generates"
interface Profile {
  id: String!
  email: String!
}

type DoctorProfile implements Profile {
  id: String!
  email: String!
  specialty: String
}

type PatientProfile implements Profile {
  id: String!
  email: String!
  insuranceId: String
}

type Query {
  profile(id: String!): Profile
}
```
:::

`needs` requests every field any member might project. At runtime the patch sets
`__typename`, and Pylon resolves the concrete member — so a client selects across
them with inline fragments:

```graphql
query {
  profile(id: "1") {
    id
    email
    ... on DoctorProfile { specialty }
    ... on PatientProfile { insuranceId }
  }
}
```

The interface and its members are derived entirely from the patch — no hand-written
classes, no variant configuration.

:::warning[Keep the discriminant literal]
The `as const` on each `__typename` is load-bearing: it keeps the discriminant a
string *literal* so the compiler can name the members. Drop it and the discriminant
widens to `string`, the members become indistinguishable, and the build fails loud
rather than emitting an invalid schema.
:::

## 6. Resolve each member from a different service

The members of a polymorphic field needn't come from one remote. Give each gateway
a patch that stamps a distinct `__typename`, then branch in the resolver and
delegate to a *different* service per member — Pylon infers one polymorphic type
spanning both:

:::generates
```ts title="You write — src/index.ts"
import {Pylon, createGateway} from '@getcronit/pylon'
import type {RemoteRegistry as DoctorsRegistry} from './generated/doctors'
import type {RemoteRegistry as PatientsRegistry} from './generated/patients'

const doctors = createGateway<DoctorsRegistry>().configure({
  url: process.env.DOCTORS_URL ?? 'http://localhost:4902/graphql',
  patches: {
    Doctor: d => ({__typename: 'DoctorProfile' as const, id: d.id, email: d.email, specialty: d.specialty})
  }
})

const patients = createGateway<PatientsRegistry>().configure({
  url: process.env.PATIENTS_URL ?? 'http://localhost:4903/graphql',
  patches: {
    Patient: p => ({__typename: 'PatientProfile' as const, id: p.id, email: p.email, insuranceId: p.insuranceId})
  }
})

export default new Pylon({
  graphql: {
    Query: {
      // One field, two services — each branch delegates to a different remote.
      profile: (id: string, kind: string) =>
        kind === 'doctor'
          ? doctors.delegate('Query.doctor', {args: {id}, needs: {id: true, email: true, specialty: true}})
          : patients.delegate('Query.patient', {args: {id}, needs: {id: true, email: true, insuranceId: true}})
    }
  }
})
```
```graphql title="Pylon generates"
interface Profile {
  id: String!
  email: String!
}

type DoctorProfile implements Profile {
  id: String!
  email: String!
  specialty: String!
}

type PatientProfile implements Profile {
  id: String!
  email: String!
  insuranceId: String!
}

type Query {
  profile(id: String!, kind: String!): Profile!
}
```
:::

`DoctorProfile` is fetched from the doctors service and `PatientProfile` from the
patients service, but a client sees one polymorphic `profile` field — Pylon names
the synthesized type after the field, and each branch only calls its own remote.

Whether you get an **interface** or a **union** is decided by the members: sharing
fields (here `id` and `email`) yields an interface; sharing none yields a union —
same code, the member shapes decide.

```graphql title="Disjoint members → a union"
union Profile = DoctorProfile | PatientProfile
```

See [Interfaces & Unions](/docs/core-concepts/interfaces-unions) for how `__typename`
maps to GraphQL members, interfaces, and unions.

:::tip
Forward the incoming `authorization` header through `headers` so the remote
enforces the caller's permissions — the gateway should pass identity through, not
replace it.
:::

The delegate keys, `needs` semantics, and polymorphic stitching are detailed in
[Gateway](/docs/core-concepts/gateway).
