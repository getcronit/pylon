---
title: Infinite-Scroll Feed
nav: Infinite Scroll
description: Build an endless list — a paginated connection, usePaginatedData, and a sentinel that loads the next window as you scroll.
section: Guides
order: 4
---

An infinite-scroll feed loads more rows as the reader reaches the bottom, without
a "next page" click. This guide builds one end to end: a `Post` model, a paginated
connection on the schema, and a page that renders the merged nodes and calls
`loadNext()` from an IntersectionObserver sentinel. The first window renders on the
server; every window after that loads on the client and merges in place.

## 1. Model and connection

Define the model, then expose a Relay-style connection field by returning
`.paginate()`. The pagination arguments you declare on the field
(`first`/`after`/`last`/`before`) are what `usePaginatedData` drives:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {db, models} from '@getcronit/pylon/db'

export class Post extends models.Model {
  static objects = db.manager(Post)
  id = models.ID()
  title = models.Text()
  createdAt = models.CreatedAt()
}

export default new Pylon({
  db: {models: [Post]},
  graphql: {
    Query: {
      // `.paginate()` returns a Relay connection; the field's args drive the window
      posts: (first?: number, after?: string, last?: number, before?: string) =>
        Post.objects.paginate({first, after, last, before, orderBy: '-createdAt'})
    }
  }
})
```

`.paginate()` returns `{edges, nodes, pageInfo, totalCount}` — Pylon introspects it
into a `PostConnection` with `first`/`after`/`last`/`before` arguments, exactly what
the hook expects. Use `orderBy: '-createdAt'` (a single string, `-` for descending)
to give the cursor a stable sort.

## 2. Read it with usePaginatedData

`usePaginatedData(selector, args?)` points at the connection field and returns the
merged `nodes`, the loaders, and `pageInfo`. The selector picks the field; the
second argument carries the page size (`first`) plus any base arguments:

```tsx title="pages/feed/page.tsx"
import {usePaginatedData} from '@getcronit/pylon/pages'

export default function FeedPage() {
  const posts = usePaginatedData(q => q.posts, {first: 20})

  return (
    <ul>
      {posts.nodes.map(post => (
        <li key={post.id}>{post.title}</li>
      ))}
      {posts.pageInfo.hasNextPage && (
        <button onClick={() => posts.loadNext()} disabled={posts.isLoadingMore}>
          {posts.isLoadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </ul>
  )
}
```

`posts.nodes` is every loaded window flattened in display order. `loadNext()`
appends the next window and merges it in — reading position and scroll stay put.
`isLoadingMore` is `true` while a load is in flight; it doesn't suspend, so the
list stays mounted.

## 3. Turn the button into a scroll sentinel

To load on scroll instead of click, place an empty sentinel after the list and
fire `loadNext()` whenever it enters the viewport. An IntersectionObserver on a
`ref` does this:

```tsx title="pages/feed/page.tsx"
import {useEffect, useRef} from 'react'
import {usePaginatedData} from '@getcronit/pylon/pages'

export default function FeedPage() {
  const posts = usePaginatedData(q => q.posts, {first: 20})
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = sentinel.current
    if (!node) return

    const observer = new IntersectionObserver(entries => {
      const [entry] = entries
      // load the next window when the sentinel scrolls into view
      if (entry.isIntersecting && posts.pageInfo.hasNextPage && !posts.isLoadingMore) {
        posts.loadNext()
      }
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [posts.pageInfo.hasNextPage, posts.isLoadingMore])

  return (
    <>
      <ul>
        {posts.nodes.map(post => (
          <li key={post.id}>{post.title}</li>
        ))}
      </ul>
      {/* the sentinel: when it enters the viewport, the next window loads */}
      <div ref={sentinel} />
      {posts.isLoadingMore && <p>Loading…</p>}
    </>
  )
}
```

Scroll to the bottom and the sentinel intersects, `loadNext()` fires, the next 20
posts append, and the sentinel moves down past the new rows — repeating until
`hasNextPage` is false.

## Nested connections

A connection that hangs off a parent object works the same — select through the
parent and pass its arguments alongside `first`:

```tsx title="pages/posts/[id]/page.tsx"
import {usePaginatedData, type PageProps} from '@getcronit/pylon/pages'

export default function CommentsPage({params}: PageProps) {
  const id = params.id as string
  const comments = usePaginatedData(q => q.post({id}).comments, {first: 25})

  return (
    <div>
      {comments.nodes.map(c => (
        <p key={c.id}>{c.body}</p>
      ))}
    </div>
  )
}
```

Here `id` parameterizes `post`, and the pagination keys (`first`/`after`) are
hook-managed — you never set them by hand.

:::note
Each cursor window is a separate compiled operation with its own variables. The
hook composes them in display order and exposes one continuous list, so appending
a window never re-fetches the ones you already have.
:::

`usePaginatedData` also exposes `loadPrev`, `jumpTo`, `totalCount`, and
`startIndex` for bidirectional and virtualized lists. The full surface is in
[Pagination](/docs/frontend/pagination).
