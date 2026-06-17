---
title: Project Structure
description: What's in a Pylon project and what each file is for.
section: Introduction
order: 4
---

A new Pylon project is small. Here's what `npm create pylon@latest` gives you and
what each piece does.

```
my-pylon/
├── src/
│   └── index.ts          # your API: the `graphql` export + the server entry
├── pages/                # usePages frontend (optional)
│   ├── layout.tsx        # root HTML shell
│   └── page.tsx          # the / route
├── migrations/           # generated migration files (when you use the ORM)
├── pylon.config.ts       # config and plugins
├── pylon.d.ts            # type augmentation (Bindings, Variables, Data)
├── globals.css           # Tailwind entry (with usePages)
├── postcss.config.js     # PostCSS / Tailwind (with usePages)
├── tsconfig.json         # extends Pylon's base tsconfig
└── package.json          # scripts: dev, build
```

## src/index.ts

The heart of the app — a `Pylon` instance whose `graphql` the compiler reads to
build your schema:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Query: {hello: () => 'Hello, world!'},
    Mutation: {}
  }
})
```

As your project grows, split features into their own `Pylon` instances and merge
them at the root with [`compose`](/docs/apps/overview).

## pylon.config.ts

Configuration and plugins. This is where you enable the frontend, the database,
auth, queues — and serving (the app's job, via a `'last'` plugin):

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon-pages/plugin'
import {useDatabase} from '@getcronit/pylon-db'

export default {
  plugins: [useDatabase(), usePages()]
} satisfies PylonConfig
```

See the [configuration reference](/docs/reference/config) for all options.

## pylon.d.ts

Type augmentation. Declare the shape of your environment `Bindings`, request
`Variables`, and — with usePages — wire your generated client into the `Data`
type so [`useData`](/docs/frontend/use-data) is fully typed:

```ts
import '@getcronit/pylon'
import {Query} from './.pylon/client'

declare module '@getcronit/pylon' {
  interface Bindings {}
  interface Variables {}
}

declare module '@getcronit/pylon-pages' {
  interface Data extends ReturnType<typeof Query> {}
}
```

## The .pylon/ directory

`pylon build` and `pylon dev` generate `.pylon/` — the compiled schema, the typed
client, and the bundled server. It's a build artifact: don't edit it, and keep it
out of version control (the generated `.gitignore` already does).

## Scripts

```json
{
  "scripts": {
    "dev": "pylon dev -c \"node --enable-source-maps .pylon/index.js\"",
    "build": "pylon build"
  }
}
```

`pylon dev` watches your source, rebuilds the schema and client on change, and
restarts the server. `pylon build` produces a production build. See the
[CLI reference](/docs/reference/cli) for everything else.
