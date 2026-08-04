---
title: Mutations & Imperative Queries
nav: Mutations & op
description: useMutation for writes, op.query/op.mutation for imperative reads — both compiled at build time, both normalized so every reader updates live.
section: Frontend — usePages
order: 4
---

`useData` covers the data a page renders. For writes and for one-off
operations driven by events, usePages gives you `useMutation` and the imperative
`op`. Both are compiled by the same build-time analyzer, and both normalize
their results into a shared entity store — so when you change an entity, every
`useData` that reads it re-renders.

## Mutations

`useMutation` takes a selector that picks a mutation field and returns a
`[trigger, state]` tuple:

```tsx title="pages/users/new/page.tsx"
import {useMutation} from '@getcronit/pylon-pages'

export default function NewUser() {
  const [createUser, {loading, error}] = useMutation(m => m.createUser, {
    refetch: ['users']
  })

  async function onSubmit(name: string) {
    const user = await createUser({name})
    // `user` is the typed result; the trigger throws on error
  }

  return (
    <button disabled={loading} onClick={() => onSubmit('Ada')}>
      {loading ? 'Saving…' : 'Create'}
    </button>
  )
}
```

- The trigger returns the mutation result and **throws on error** — wrap it in
  `try/catch` or read `error` from the state.
- `state` is `{loading, error}`.
- `refetch` lists tags to refresh after a successful write. The analyzer
  compiles the mutation to select the entity's id and scalars, so the changed
  fields normalize into the store automatically — `refetch` covers what the
  store can't infer, like a new row appearing in a tagged list. See
  [tags](/docs/frontend/use-data).

## Imperative operations

Sometimes you need to run a query or mutation from an event handler or an
effect, not from render. That's `op` — a plain object (not a hook) with
`query` and `mutation`. Both are **browser-only**: they run in handlers and
effects, never during SSR.

```tsx
import {op} from '@getcronit/pylon-pages'

// In an event handler:
async function onPick(id: string) {
  const location = await op.query(q => q.organization.locations({id}).nodes.at(0))
  // use `location`
}

async function onCreate() {
  const {userErrors} = await op.mutation(m => m.createUser({name: 'Ada'}))
  if (userErrors.length) { /* handle */ }
}
```

Each `op.query(cb)` / `op.mutation(cb)` is rewritten by the analyzer into a
compiled document plus the projection callback — the callback's field access
defines what the operation selects, and it then runs against the normalized
result. A mutation run through `op` updates every reader the same way
`useMutation` does — for **fields** it changes in place.

Unlike `useMutation`, `op.mutation` takes no `refetch` option, so it can't refresh
tagged **lists** on its own. After an imperative create or delete, call
`dataRefetch(tags)` yourself to update list membership.

:::tip[When to reach for which]
Render-time reads → [`useData`](/docs/frontend/use-data). Paginated lists →
[`usePaginatedData`](/docs/frontend/pagination). Writes from the UI →
`useMutation`. Reads or writes triggered by an event/effect → `op`.
:::

## What powers this

These hooks are thin wrappers over `@getcronit/pylon-query`, Pylon's owned typed
client. pylon-query does the document compilation, runs operations against your
`/graphql` endpoint, and maintains a **normalized entity store** so every result
that touches an entity updates every component reading it. In usePages you rarely
touch it directly — you import the wrappers from `@getcronit/pylon-pages`:

```ts
import {useData, usePaginatedData, useMutation, op} from '@getcronit/pylon-pages'
```

Everything — render reads, pagination, mutations, imperative ops — flows through
the same store, so the UI stays consistent without manual cache wiring.
