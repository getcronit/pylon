---
title: Build an App
description: A end-to-end walkthrough — model, API, migration, and a frontend page — in one short project.
section: Guides
order: 0
---

This guide builds a tiny but complete slice of an app: a `Post` model, queries
and a mutation, a migration, and a page that renders the data. It ties together
the pieces covered elsewhere in the docs.

## 1. Define the model

```ts
// src/models.ts
import {Model, manager, id, text, createdAt} from '@getcronit/pylon-db'
import {model} from '@getcronit/pylon-db'

@model()
export class Post extends Model {
  static objects = manager(Post)
  id = id()
  title = text({min: 1, max: 200})
  body = text()
  createdAt = createdAt()
}
```

## 2. Write the API

```ts
// src/index.ts
import {Pylon} from '@getcronit/pylon'
import {Post} from './models.js'

export default new Pylon({
  graphql: {
    Query: {
      posts: (): Promise<Post[]> => Post.objects.orderBy('-createdAt').all(),
      post: (id: number): Promise<Post> => Post.objects.get({id})
    },
    Mutation: {
      createPost: (title: string, body: string): Promise<Post> =>
        Post.objects.create({title, body})
    }
  }
})
```

## 3. Connect the database and serve

Plugins live in `pylon.config.ts`. Add the database and the frontend; serving is
the app's job via a `'last'` plugin (see [Deployment](/docs/deployment/runtimes)).

```ts
// pylon.config.ts
import {type PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon-pages/plugin'
import {useDatabase} from '@getcronit/pylon-db'

export default {
  plugins: [useDatabase(), usePages() /* , serveLast() */]
} satisfies PylonConfig
```

## 4. Generate and apply the migration

```bash
pylon db diff init
pylon db migrate
```

## 5. Render a page

```tsx
// pages/page.tsx
import {Link, useData, type PageProps} from '@getcronit/pylon-pages'

export default function Home({}: PageProps) {
  const data = useData()
  const posts = data.posts

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Posts</h1>
      <ul className="mt-4 space-y-2">
        {posts.map(p => (
          <li key={p.id}>
            <Link href={`/posts/${p.id}`}>{p.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

## 6. Run it

```bash
npm run dev
```

You now have a type-safe GraphQL API at `/graphql`, a database schema managed by
migrations, and a server-rendered page that fetches exactly the fields it
renders. From here you can add [relations](/docs/data/relations),
[policies](/docs/data/policies), [background jobs](/docs/queues/overview), and
[authentication](/docs/authentication/overview) — each a small, additive step.
