# content2 — Pylon documentation, rebuilt

A ground-up rewrite of the Pylon developer documentation and marketing copy,
structured as a clean, sequential learning path. It mirrors the renderable format
of `content/` (frontmatter + markdown + the site's custom directives), so it can
be swapped in as the live source with a two-line change.

## Layout

```text
content/
├─ _STYLE.md            # authoring guide: frontmatter, directives, voice, accuracy rules
├─ marketing/
│  └─ landing.md        # landing-page copy (source of truth for docs/pages/page.tsx)
└─ docs/                # the developer documentation tree
   ├─ introduction/     # introduction, why-pylon, how-pylon-works, getting-started, project-structure
   ├─ core-concepts/    # type-driven-schema, resolvers, the-pylon-app, context, errors, interfaces-unions, subscriptions, gateway
   ├─ data/             # overview, models, relations, queries, validation, signals, migrations, policies, multi-tenancy
   ├─ authentication/   # overview (capability authz; resource authz lives under data/policies)
   ├─ apps/             # overview (composable feature modules)
   ├─ frontend/         # overview, routing, use-data, pagination, data-client, layouts, loading-and-errors, server-context, styling
   ├─ queues/           # overview (background jobs)
   ├─ production/       # runtimes, deployment, observability
   ├─ guides/           # build-an-app, multi-tenant-saas, migrating-from-prisma, testing
   └─ reference/        # cli, config
```

## Reading order (sidebar sections)

The site groups pages by the `section` frontmatter field and orders the groups by
an explicit list. For this tree the order is:

1. Introduction
2. Core Concepts
3. Data — pylon-db
4. Authentication
5. Apps
6. Frontend — usePages
7. Background Jobs
8. Production
9. Guides
10. Reference

## Making it live

The docs site reads from `content/docs` (see `docs/src/lib/content.ts`,
`CONTENT_DIR`). To preview this tree instead:

1. Point `CONTENT_DIR` at `content2` in `docs/src/lib/content.ts`
   (or rename `content` → `content_old` and `content2` → `content`).
2. Update `SECTION_ORDER` in `docs/src/index.ts` to the list above
   (it adds `Authentication` and `Background Jobs`, and renames `Frontend`'s
   group to match).
3. Run `pylon dev` in `docs/`.

The marketing copy in `marketing/landing.md` is the source of truth for the React
landing page at `docs/pages/page.tsx` — keep the two in sync.
