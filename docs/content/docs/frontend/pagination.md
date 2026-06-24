---
title: Pagination
nav: Pagination
description: Bidirectional Relay pagination with usePaginatedData — load forward and back, jump to any index, SSR-render the first window.
section: Frontend — usePages
order: 3
---

`usePaginatedData` is the hook for Relay-style connections. You point it at a
connection field; it returns the merged nodes, page info, and a set of loaders —
`loadNext`, `loadPrev`, and `jumpTo` — for moving through the list in both
directions. The first window renders on the server; subsequent windows load on
the client.

## The shape

```tsx title="pages/posts/page.tsx"
import {usePaginatedData} from '@getcronit/pylon-pages'

export default function PostsPage() {
  const posts = usePaginatedData(q => q.posts, {first: 20})

  return (
    <>
      <ul>
        {posts.nodes.map(post => (
          <li key={post.id}>{post.title}</li>
        ))}
      </ul>
      {posts.pageInfo.hasNextPage && (
        <button onClick={() => posts.loadNext()} disabled={posts.isLoadingMore}>
          Load more
        </button>
      )}
    </>
  )
}
```

The first argument is a **selector** that picks the connection field; the
optional second argument carries the page size (`first`) plus any base arguments
the field takes.

## What it returns

```ts
interface PaginatedResult<TNode, TEdge> {
  nodes: TNode[]          // flattened nodes across all loaded windows
  edges: TEdge[]          // edges across all loaded windows
  pageInfo: PageInfo      // merged: next from the last window, prev from the first
  totalCount?: number
  startIndex: number      // absolute index of nodes[0] within the full list
  loadNext: (n?: number) => Promise<void>
  loadPrev: (n?: number) => Promise<void>
  jumpTo: (index: number, n?: number) => Promise<void>
  refetch: () => Promise<void>
  isLoadingMore: boolean
}
```

- `nodes` / `edges` — every loaded window, flattened in display order.
- `pageInfo` — the merged `{hasNextPage, hasPreviousPage, startCursor,
  endCursor}` across the loaded range.
- `startIndex` — the absolute position of `nodes[0]` within the full list. A
  virtualizer places the window against `totalCount` with this.
- `loadNext(n?)` / `loadPrev(n?)` — append / prepend a window; `n` overrides the
  page size.
- `jumpTo(index, n?)` — deep-link the window to an absolute index. Requires a
  `skip` argument on the connection.
- `refetch()` — re-fetch every loaded window in place, keeping scroll position.
- `isLoadingMore` — `true` while a `loadNext`/`loadPrev`/`jumpTo` is in flight
  (these don't suspend).

## Top-level connections

Point the selector straight at the connection field:

```tsx
const posts = usePaginatedData(q => q.posts, {first: 20})
```

Pass base arguments alongside `first` and they're forwarded as query variables:

```tsx
const posts = usePaginatedData(q => q.posts, {first: 20, category: 'news'})
```

## Nested connections

A connection that hangs off a parent object works the same — select through the
parent and supply its arguments in the args object:

```tsx title="pages/posts/[id]/page.tsx"
import {usePaginatedData, type PageProps} from '@getcronit/pylon-pages'

export default function CommentsPage({params}: PageProps) {
  const id = params.id as string
  const comments = usePaginatedData(q => q.post({id}).comments, {
    role: 'public',
    first: 25
  })

  return (
    <div>
      {comments.nodes.map(c => (
        <p key={c.id}>{c.body}</p>
      ))}
      {comments.pageInfo.hasNextPage && (
        <button onClick={() => comments.loadNext()}>More</button>
      )}
    </div>
  )
}
```

Here `id` parameterizes `post`, and `role` is a base argument on the `comments`
connection. The pagination keys (`first`/`after`/`last`/`before`/`skip`) are
hook-managed — you never set them by hand.

## How windows work

Each cursor window is a **separate compiled operation** with its own variables.
The hook composes them in display order and exposes the result as one continuous
list. The first window is rendered during SSR; `loadNext`/`loadPrev` fetch
adjacent windows imperatively and merge them in, so reading position and scroll
stay put.

:::note
`jumpTo(index)` needs a `skip` (offset) argument on the connection to anchor an
arbitrary page. Without one, only the cursor-adjacent `loadNext`/`loadPrev` are
available — the hook throws a clear error if you call `jumpTo` on a connection
that has no `skip`.
:::

To refresh a paginated list after a mutation, tag it and call `dataRefetch` — or
call `refetch()` directly. See [Fetching Data](/docs/frontend/use-data) for
tags.

:::tip[Related guide]
See [Infinite-Scroll Feed](/docs/guides/infinite-scroll-feed) for a full `loadNext` + IntersectionObserver walkthrough.
:::
