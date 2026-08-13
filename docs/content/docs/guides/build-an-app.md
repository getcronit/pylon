---
title: Build an App
description: A complete slice of a Pylon app — model, API, frontend page, and migrations — in one short project.
section: Guides
order: 0
---

This guide builds a small but complete task tracker: a `Task` model, queries and
a mutation, a server-rendered page that reads the data, and the migration that
creates the table. Every layer comes from the same TypeScript — define the model
once and it drives the database, the GraphQL API, and the types your page reads.

## 1. Scaffold the project

Create a new project and start in it:

```bash
npm create pylon@latest tracker
cd tracker
npm install
```

The scaffold gives you `src/index.ts` (your app), `pylon.config.ts` (plugins and
serving), and a `pages/` directory for the frontend. See the
[CLI reference](/docs/reference/cli) for runtime and feature flags.

## 2. Define a model

A model is a TypeScript class. It becomes a database table and a GraphQL type at
once — there is no separate schema file to keep in sync.

```ts title="src/models.ts"
import {Model, manager, id, text, boolean, createdAt} from '@getcronit/pylon/db'

export class Task extends Model {
  static objects = manager(Task)

  id = id()
  title = text({min: 1, max: 200})
  done = boolean({default: false})
  createdAt = createdAt()
}
```

The model becomes live by being listed in your app's `db.models` (next step).

:::generates
```ts title="You write"
class Task extends Model {
  id = id()
  title = text({min: 1, max: 200})
  done = boolean({default: false})
}
```

```graphql title="Pylon generates"
type Task {
  id: ID!
  title: String!
  done: Boolean!
}
```
:::

`static objects = manager(Task)` is the query manager — the typed entry point for
creating and fetching rows. See [Models & Fields](/docs/data/models).

## 3. Expose resolvers

The app's entry contract is one default export: a `Pylon` instance whose
`graphql` property holds your resolvers. The compiler reads the type of that
property to derive the schema.

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {Task} from './models.js'

export default new Pylon({
  db: {models: [Task]},
  graphql: {
    Query: {
      tasks: (): Promise<Task[]> => Task.objects.orderBy('-createdAt').all(),
      task: (id: number): Promise<Task> => Task.objects.get({id})
    },
    Mutation: {
      addTask: (title: string): Promise<Task> => Task.objects.create({title}),
      toggleTask: async (id: number): Promise<Task> => {
        const t = await Task.objects.get({id})
        t.done = !t.done
        await t.$save()
        return t
      }
    }
  }
})
```

A resolver returns a model instance, and the field types come straight from the
class. See [Resolvers](/docs/core-concepts/resolvers) and
[Queries](/docs/data/queries) for the full manager API.

## 4. Connect the database and serve

Plugins live in `pylon.config.ts`. Add `useDatabase` for the ORM, `usePages` for
the frontend, and a `'last'`-strategy plugin that starts the HTTP server after
every route is mounted.

```ts title="pylon.config.ts"
import {serve} from '@hono/node-server'
import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon/db/plugin'
import {usePages} from '@getcronit/pylon/pages/plugin'

export default {
  plugins: [
    useDatabase(),
    usePages(),
    {
      name: 'serve',
      strategy: 'last',
      setup: app => {
        serve({fetch: app.fetch, port: Number(process.env.PORT) || 3000})
      }
    }
  ]
} satisfies PylonConfig
```

See [Configuration](/docs/reference/config) for every plugin option.

## 5. Render a page

A page is a default-exported component in `pages/**/page.tsx`. Call `useData` and
read the fields you want — the build step compiles a GraphQL query for **exactly
the fields the page reads**, resolves it during SSR, and hydrates the result.

```tsx title="pages/page.tsx"
import {Link, useData} from '@getcronit/pylon/pages'

export default function Home() {
  const data = useData()

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Tasks</h1>
      <ul className="mt-4 space-y-2">
        {data.tasks.map(task => (
          <li key={task.id}>
            <Link href={`/tasks/${task.id}`}>
              {task.done ? '✓ ' : ''}
              {task.title}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

You never write a query string or maintain a fragment. Read more fields and the
generated query grows; stop reading a field and it drops out. See
[Fetching data with useData](/docs/frontend/use-data).

To create and toggle tasks from the UI, use `useMutation` — it normalizes the
result into the entity store so every reader updates live:

```tsx title="pages/new/page.tsx"
import {useMutation} from '@getcronit/pylon/pages'

export default function NewTask() {
  const [addTask, {loading}] = useMutation(m => m.addTask, {refetch: ['tasks']})

  return (
    <button disabled={loading} onClick={() => addTask({title: 'Write the docs'})}>
      {loading ? 'Saving…' : 'Add task'}
    </button>
  )
}
```

See [Mutations & Imperative Queries](/docs/frontend/data-client).

## 6. Run it

`pylon dev` type-introspects the schema, builds the server and pages, watches your
source, and live-reloads the browser on change:

```bash
pylon dev
```

The first run needs a database. Set `DATABASE_URL`, then sync your models straight
to the database for fast iteration:

```bash
export DATABASE_URL=postgres://localhost/tracker
pylon db push
```

`pylon db push` is for prototyping — it applies model changes without recording a
migration. The GraphiQL explorer is live at `/graphql`, and your page renders at
`/`.

## 7. Capture a migration and build

When the schema settles, record a migration instead of pushing. This is the path
you take to production:

```bash
pylon db diff init   # generate migrations/init from the current models
pylon db migrate     # apply pending migrations to DATABASE_URL
pylon build          # compile the server, client, and pages into ./.pylon
```

`pylon build` produces the runnable app under `./.pylon` (unbundled — shipped with
your `node_modules`) that you run with the same serve plugin. In production, apply
migrations with `pylon db deploy` — it refuses to run
if the models contain changes no migration has captured. See
[Migrations](/docs/data/migrations) and [Deployment](/docs/production/deployment).

## Where to go next

You now have a type-safe GraphQL API, a migration-managed schema, and a
server-rendered page that fetches exactly what it renders. From here, each
addition is a small, additive step:

- [Relations](/docs/data/relations) — connect models with foreign keys and
  many-to-many.
- [Authentication](/docs/authentication/overview) — bind a `Principal` per
  request and gate operations.
- [Authorization](/docs/data/policies) — row-level abilities that apply to every
  query and write.
- [Background Jobs](/docs/queues/overview) — typed queues with a transactional
  outbox.
- [Multi-Tenant SaaS](/docs/guides/multi-tenant-saas) — combine tenancy, auth,
  and apps into one service.
