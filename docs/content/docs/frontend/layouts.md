---
title: Layouts
nav: Layouts
description: Nested layout.tsx files wrap their subtree — the root layout renders the HTML shell, nested layouts add shared chrome.
section: Frontend — usePages
order: 5
---

A `layout.tsx` wraps every route in its directory and below. The **root layout**
renders the HTML document; nested layouts add shared chrome — navigation,
sidebars, footers — to a section without repeating it on every page. Layouts
nest: a route is rendered inside its own layout, inside its parent's, all the way
up to the root.

## The root layout

`pages/layout.tsx` owns the `<html>` and `<body>` tags. It's the only place
those appear, and it's where your stylesheet is imported — Pylon
content-hashes the CSS and links it into the head from here:

```tsx title="pages/layout.tsx"
import type {LayoutProps} from '@getcronit/pylon/pages'
import '../globals.css'

export default function RootLayout({children}: LayoutProps) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900">
        {children}
      </body>
    </html>
  )
}
```

See [Styling](/docs/frontend/styling) for how the stylesheet is processed and
injected.

## LayoutProps

A layout receives everything a page does, plus `children`:

```ts
type LayoutProps = PageProps & {
  children: React.ReactNode
}
```

So a layout can read `params`, `searchParams`, `path`, and `context` — useful
for highlighting the active nav item or branching on auth in shared chrome. See
[Server Context](/docs/frontend/server-context).

## Nested layouts

A `layout.tsx` deeper in the tree wraps just its section. A docs layout that adds
a sidebar around every `/docs/*` page:

```tsx title="pages/docs/layout.tsx"
import {Link, type LayoutProps} from '@getcronit/pylon/pages'

export default function DocsLayout({children, path}: LayoutProps) {
  return (
    <div className="flex gap-8">
      <nav className="w-56 shrink-0">
        <Link href="/docs/overview" aria-current={path === '/docs/overview'}>
          Overview
        </Link>
        <Link href="/docs/routing">Routing</Link>
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  )
}
```

The composition for a request to `/docs/routing` is:

```
RootLayout
  └─ DocsLayout
       └─ page.tsx (the route)
```

The root layout renders the HTML shell once; the docs layout renders the sidebar
once; the page renders inside both. Navigate between two `/docs/*` pages and the
shells stay mounted — only the innermost route swaps.

:::tip
Keep data-fetching in layouts to shared concerns — a nav that needs the current
user, a section header. A layout's `useData` reads compile into the same
build-time analysis as a page's, so the shared query is generated for you too.
:::

:::note
Only the **root** layout may render `<html>`/`<body>`. Nested layouts render
plain elements — they're already inside the document.
:::
