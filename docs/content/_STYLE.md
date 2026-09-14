# content authoring guide (internal — not a doc page)

This file defines the format, structure, and voice for every page under `content2/`.
It is the single source of truth handed to section authors. Do not deviate.

## File format

Every page is a `.md` file with YAML frontmatter, then markdown body.

```md
---
title: Models & Fields
nav: Models # optional — sidebar label, defaults to title
description: One sentence, benefit-first, ~120 chars max. No trailing period optional.
section: Data — pylon-db # MUST match a section name exactly (see SECTION_ORDER)
order: 1 # sort within section, integers, lower first
---

Body starts here. Do NOT repeat the title as an `# H1` — the renderer prints
title + description as the page header automatically. Start with a lead paragraph.
```

### SECTION_ORDER (exact strings — must match frontmatter `section`)

1. `Introduction`
2. `Core Concepts`
3. `Data — pylon-db` (note: em dash `—`, not a hyphen)
4. `Authentication`
5. `Apps`
6. `Frontend — usePages`
7. `Background Jobs`
8. `Production`
9. `Guides`
10. `Reference`

## Markdown features available

- Standard GFM (tables, task lists, fenced code).
- Code fences support a title: ` ```ts title="src/index.ts" `
- Highlight notations inside code: `// [!code highlight]`, `// [!code ++]`, `// [!code --]`, `// [!code focus]`.
- Callouts (container directives):
  - `:::note`, `:::tip`, `:::info`, `:::important`, `:::warning`, `:::caution`
  - Optional title: `:::tip[Pro tip]` … `:::`
- The signature **generates** directive — side-by-side "you write → Pylon generates".
  It MUST contain exactly two code fences:
  ````md
  :::generates

  ```ts title="You write"
  class User {
    id!: string
    name!: string
  }
  ```
  ````
  ```graphql title="Pylon generates"
  type User {
    id: String!
    name: String!
  }
  ```
  :::
  ```

  ```
- Headings: use `##` and `###` only (h2/h3 feed the table of contents). Never `#`.
- Internal links use absolute doc slugs: `[models](/docs/data/models)`.

## Voice & style

Pylon's voice is **confident, concrete, and plain**. Study these real samples:

> Most backends make you say everything twice. You describe your data in a schema
> language, then again in your resolvers, then again in your database migrations,
> and then a fourth time in your client types. Every layer is a chance for them to
> drift apart. **Pylon collapses those layers.**

> One TypeScript codebase. A compiler derives the API, the database, and the
> frontend — and proves they stay consistent.

Rules:

- Lead with the problem or the payoff, then show code. Show, don't tell.
- Short declarative sentences. Cut hedging ("you might want to maybe consider").
- Second person ("you write", "your schema"). Present tense.
- Bold the key claim once per section, sparingly.
- Every concept gets a minimal, COPY-PASTEABLE, CORRECT code example.
- Em dashes for asides — like this. Avoid exclamation marks.
- Never say "simply" / "just" as a crutch. Never "in this tutorial".

## Accuracy directive (IMPORTANT)

Write the **full intended framework** confidently and without caveats or
"coming soon" labels. Present the intended public API surface as the real,
shipping surface:

- Import everything from the single package's subpaths: `@getcronit/pylon`,
  `@getcronit/pylon/db`, `@getcronit/pylon/auth`, `@getcronit/pylon/queues`,
  `@getcronit/pylon/pages`, `@getcronit/pylon/query`. Plugin factories live under a
  per-feature `/plugin` subpath — `@getcronit/pylon/db/plugin` (`useDatabase`),
  `@getcronit/pylon/auth/plugin` (`useIdentity`), `@getcronit/pylon/queues/plugin`
  (`useQueues`), `@getcronit/pylon/pages/plugin` (`usePages`).
- Use the **v3 entry contract** everywhere:
  - `export default new Pylon({ graphql, gate?, basePath? })`
  - Compose apps with `Pylon.compose(appA, appB)`
  - Serving is owned by the app via a `strategy: 'last'` plugin in
    `pylon.config.ts` that calls the host `serve()`. There is NO
    `export const graphql` named export and NO `.resolvers()`.
- Do NOT document the old v2 contract (`import {app}`, `export const graphql`,
  `serve(app, …)`), even though `create-pylon` still emits it.
- Keep examples technically coherent — names, signatures, and import paths must
  match the real exports the analysis reports provide. Do not invent APIs that
  contradict the code; when filling a vision gap, choose the natural shape that
  matches the existing surface.

## The canonical hello-world (reuse verbatim where a first example is needed)

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'

class User {
  id!: string
  name!: string
  email!: string | null
}

export default new Pylon({
  graphql: {
    Query: {
      user: (id: string): User => ({id, name: 'Ada', email: null})
    }
  }
})
```
