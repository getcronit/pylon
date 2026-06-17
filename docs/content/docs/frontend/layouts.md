---
title: Layouts
description: Share chrome and structure across routes with nested layouts.
section: Frontend — usePages
order: 1
nav: Layouts
---

A `layout.tsx` wraps every route in its directory and below. Layouts nest, so you
compose shared chrome — headers, sidebars, providers — without repeating it on
every page.

## The root layout

The root `pages/layout.tsx` renders the HTML document. It's the one place to put
`<html>`, `<head>`, global styles, and fonts:

```tsx
// pages/layout.tsx
import '../globals.css'

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

## Nested layouts

A layout deeper in the tree wraps just the routes beneath it. Given:

```
pages/
  layout.tsx            → wraps everything
  page.tsx              → /
  dashboard/
    layout.tsx          → wraps /dashboard and its children
    page.tsx            → /dashboard
    settings/
      page.tsx          → /dashboard/settings
```

`/dashboard/settings` renders inside the dashboard layout, which renders inside
the root layout. The dashboard layout is the natural home for a sidebar or a
section header:

```tsx
// pages/dashboard/layout.tsx
import {type LayoutProps} from '@getcronit/pylon-pages'

export default function DashboardLayout({children}: LayoutProps) {
  return (
    <div className="grid grid-cols-[16rem_1fr]">
      <aside>{/* dashboard nav */}</aside>
      <main>{children}</main>
    </div>
  )
}
```

Because layouts persist across navigations within their subtree, state they hold
(an open menu, a scroll position) survives as you move between child pages.
