---
title: useData
description: Fetch typed data from your own GraphQL schema — with the query computed at build time from what you render.
section: Frontend — usePages
order: 1
nav: Data fetching
---

`useData` is how a usePages page reads data. You access fields on a typed proxy,
and Pylon's build step analyzes exactly which fields and arguments you use to
generate the minimal GraphQL query — so each page fetches precisely what it
renders, no more.

## Typed access

`useData()` returns a proxy typed from your backend's schema. Read fields, call
fields that take arguments, and map over lists:

```tsx
import {useData, type PageProps} from '@getcronit/pylon-pages'

export default function Page({}: PageProps) {
  const data = useData()

  const posts = data.posts // typed from your `graphql` Query
  return (
    <ul>
      {posts.map(p => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  )
}
```

To get full typing, your app's `pylon.d.ts` augments the `Data` interface with
your generated client (this is set up for you in new projects):

```ts
// pylon.d.ts
import {Query} from './.pylon/client'

declare module '@getcronit/pylon-pages' {
  interface Data extends ReturnType<typeof Query> {}
}
```

## Fields with arguments

Call a field like a function to pass arguments. Arguments can be **runtime
values** — route params, props, state — and the build-time analyzer carries them
into the query:

```tsx
export default function PostPage({params}: PageProps) {
  const id = params.id as string // a plain local the analyzer can resolve
  const data = useData()
  const post = data.post({id})
  return <h1>{post?.title}</h1>
}
```

:::tip
Compute argument values into a simple local variable on its own line, then pass
that variable. The analyzer resolves plain identifiers cleanly.
:::

## How the query is built

There is no query string to write or keep in sync. At build time Pylon inspects
your component, sees which fields and arguments you access on the `useData`
proxy, and generates an optimal query. At request time the server resolves it,
renders the HTML, and serializes the result so the client hydrates instantly.

## Refetching

`useData` results can be invalidated and refetched with tags:

```tsx
const data = useData({tags: ['posts']})
// ... elsewhere, after a mutation:
import {dataRefetch} from '@getcronit/pylon-pages'
dataRefetch(['posts'])
```

This keeps the data layer declarative: components describe what they need, and
Pylon handles fetching, server rendering, hydration, and revalidation.
