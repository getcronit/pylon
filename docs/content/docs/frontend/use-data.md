---
title: Fetching Data with useData
nav: useData
description: Read typed fields off your schema — the build step compiles the minimal GraphQL query for exactly what each page renders.
section: Frontend — usePages
order: 2
---

`useData` is the central mechanism of usePages. You call it, read typed fields
off the result, and **at build time the analyzer compiles a GraphQL document for
exactly the fields the page reads** — no more, no less. You never write a query
string, never maintain a fragment, and never over- or under-fetch.

## The shape

```tsx title="pages/posts/page.tsx"
import {useData, type PageProps} from '@getcronit/pylon/pages'

export default function PostsPage({}: PageProps) {
  const data = useData()

  return (
    <ul>
      {data.posts.map(post => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  )
}
```

`data` is the typed root of your schema. List fields are arrays you can `.map`.
Fields that take arguments are **called**, with the args as an object:

```tsx
const data = useData()
const post = data.post({id})            // Query.post(id: ID!): Post
const title = data.docPage({slug}).title
```

## The query is generated for you

The build step walks the component, records every field you actually read, and
emits the minimal document. Read more fields and the query grows; stop reading a
field and it drops out.

:::generates
```tsx title="You write"
const data = useData()
const post = data.post({id})
return (
  <article>
    <h1>{post.title}</h1>
    <p>by {post.author.name}</p>
  </article>
)
```

```graphql title="Pylon generates"
query ($id: ID!) {
  post(id: $id) {
    title
    author {
      name
    }
  }
}
```
:::

The compiled document lives at module scope and the field-argument variables are
evaluated lazily, in JSX — so reads are **TDZ-safe**: a variable like `id` is
never touched before the component's `const`s have run. The query is resolved
during SSR and serialized into the page, so the client hydrates without an extra
round-trip.

## Interfaces & unions (inline fragments)

When a field returns an interface or union — a `blocks: [Block!]!` where `Block`
is `TextBlock | FaqBlock | …` — you never write `... on FaqBlock`. You read the
concrete fields **flatly** and narrow on `__typename`. The analyzer sees which
member declares each field you read and compiles the inline fragments for you:

:::generates
```tsx title="You write"
const data = useData()
const page = data.page({slug: 'home'})

return (
  <div>
    {page.blocks.map(block => {
      if (block.__typename === 'FaqBlock') {
        return block.entries.map(e => <FaqRow key={e.q} q={e.q} a={e.a} />)
      }
      if (block.__typename === 'TextBlock') {
        return <Prose key={block.id}>{block.text}</Prose>
      }
      return null
    })}
  </div>
)
```

```graphql title="Pylon generates"
query ($slug: String!) {
  page(slug: $slug) {
    blocks {
      __typename
      ... on TextBlock { text }
      ... on FaqBlock { entries { q a } }
    }
  }
}
```
:::

The `if (block.__typename === 'FaqBlock')` check does double duty: TypeScript
**narrows** `block` to `FaqBlock` so `block.entries` type-checks, and that read is
what tells the analyzer to place `entries { q a }` inside `... on FaqBlock`.
Fragment placement is schema-driven — a field lands in the fragment for whichever
member declares it — so you get the same document whether you narrow first or read
`block.entries` behind a `block.__typename === 'FaqBlock' && …` guard.

A few things follow from this:

- **`__typename` is the discriminator.** It's always available on a polymorphic
  value and typed as a literal union (`"TextBlock" | "FaqBlock"`), so a `switch`
  or `if` chain over it is exhaustively checkable.
- **A concrete field read off the wrong member is `undefined`.** The wrapper
  dispatches each field by the value's runtime `__typename`, so `block.text` on a
  `FaqBlock` is `undefined` — which is exactly why the narrowing (or a `?.`) isn't
  optional. TypeScript's control-flow narrowing enforces this at author time.
- **Interface fields need no narrowing.** A field declared on the interface itself
  (here `id` on `Block`) is read directly and is *required* in the result type;
  only the members' own fields are optional. The generated result type is
  merged-optional:

  ```ts
  page.blocks: Array<{
    __typename: 'TextBlock' | 'FaqBlock'
    text?: string | null        // TextBlock
    entries?: Array<{q: string; a: string}>  // FaqBlock
  }>
  ```

This works nested and through lists to any depth — `... on FaqBlock { entries { q a } }`
is itself a concrete object selected inside a fragment. When two members declare a
field of the *same* name but *different* types (`status: TicketStatus` vs
`status: TaskStatus`), the compiler aliases them apart on the wire and re-joins them
on read, so you still read `node.status` — no manual aliasing.

:::tip
This is the read side. For how interfaces and unions arise from your TypeScript on
the **schema** side (class inheritance, object unions, `__typename` resolution),
see [Interfaces & Unions](/docs/core-concepts/interfaces-unions).
:::

## Options

`useData` accepts a `UseDataOptions` object:

```ts
const data = useData() // authoring form — the analyzer fills in the rest
```

```ts
interface UseDataOptions {
  // Refetch this query when dataRefetch(tags) is called with a matching tag.
  tags?: string[]
  // Escape hatch: skip the build-time document. Returns the root type
  // without fetching — debugging only.
  disableBuildTimeGeneration?: boolean
}
```

Tag a query to make it refetchable by name:

```tsx
const data = useData({tags: ['posts']})
```

## Refetching with tags

`dataRefetch(tags)` triggers a refetch of every mounted query carrying a
matching tag. It pairs with the `refetch` option on mutations — create a post,
refresh the list:

```tsx
import {dataRefetch, useData, useMutation} from '@getcronit/pylon/pages'

export default function Posts() {
  const data = useData({tags: ['posts']})
  const [createPost] = useMutation(m => m.createPost, {refetch: ['posts']})

  return (
    <>
      <button onClick={() => createPost({title: 'Hello'})}>New</button>
      <ul>{data.posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
    </>
  )
}
```

A mutation's result normalizes into the entity store, so a field you change in
place updates everywhere it's read without any tag. Tags cover what the store
can't infer — **list membership** after a create or delete.

### Imperative refetch

When one component just needs to refresh its own query — a "reload" button, a
poll, a refetch after some event — the `useData` result carries a `$refetch()`
method. It re-runs only that query, no tags required:

```tsx
export default function Feed() {
  const data = useData()
  return (
    <>
      <button onClick={() => data.$refetch()}>Refresh</button>
      <ul>{data.posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
    </>
  )
}
```

Use `$refetch()` for a single component's own data; use `dataRefetch(tags)` when a
write elsewhere should refresh every list carrying a tag.

:::tip
For lists you scroll or page through, reach for
[`usePaginatedData`](/docs/frontend/pagination) instead of `useData`. For
mutations and one-off imperative queries, see
[Mutations & Imperative Queries](/docs/frontend/data-client).
:::
