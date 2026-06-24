---
title: Styling
nav: Styling
description: Tailwind out of the box, content-hashed CSS linked from the root layout, plus the Link and Image components.
section: Frontend — usePages
order: 8
---

usePages ships with Tailwind. You import a stylesheet once in the root layout —
either the bundled `@getcronit/pylon-pages/index.css` or your own
`globals.css` — and Pylon content-hashes it and links it into the document head
at build time. Alongside styling, usePages gives you a `Link` for navigation and
an `Image` component that serves optimized images through a media proxy.

## Tailwind & the stylesheet

Import your CSS in the root layout. The bundled stylesheet sets up Tailwind and
Pylon's base styles:

```tsx title="pages/layout.tsx"
import type {LayoutProps} from '@getcronit/pylon-pages'
import '@getcronit/pylon-pages/index.css'

export default function RootLayout({children}: LayoutProps) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
```

To add your own styles — custom Tailwind config, fonts, base rules — point at a
local `globals.css` instead:

```tsx title="pages/layout.tsx"
import '../globals.css'
```

```css title="globals.css"
@import 'tailwindcss';

:root {
  --brand: #0f62fe;
}
```

The build pipeline processes the stylesheet, content-hashes the output, and
links it from the root layout's head — so the browser caches it aggressively and
busts the cache automatically when the CSS changes. You write Tailwind classes on
your elements and they work, server-rendered and hydrated.

## The Link component

`Link` does client-side navigation. It takes an **`href`** prop (not `to`):

```tsx
import {Link} from '@getcronit/pylon-pages'

<Link href="/docs/overview">Read the docs</Link>
<Link href={`/posts/${post.id}`} className="text-brand underline">
  {post.title}
</Link>
```

Navigations through `Link` keep layouts mounted and swap only the inner route —
no full page reload.

## The Image component

`Image` serves optimized images through Pylon's media proxy — resized to the
dimensions you ask for, with an optional blur placeholder:

```tsx
import {Image} from '@getcronit/pylon-pages'

<Image
  src="/uploads/cover.jpg"
  width={1200}
  height={630}
  alt="Cover image"
  blurDataURL={post.blurDataURL}
/>
```

Props:

- `src` — the image URL.
- `width` / `height` — the rendered dimensions; the proxy serves an image sized
  to match.
- `alt` — alternative text.
- `fill` — stretch to fill the positioned parent instead of using fixed
  `width`/`height`.
- `blurDataURL` — a tiny placeholder shown until the full image loads.

```tsx
// Fill a positioned container:
<div className="relative aspect-video">
  <Image src={post.cover} fill alt="" />
</div>
```

:::tip
Generate a `blurDataURL` once when you store the image and read it back as a
field on the entity. usePages renders it as the placeholder, so layout doesn't
shift when the full image arrives.
:::

Both components import from `@getcronit/pylon-pages`. For where the stylesheet
gets linked and how layouts compose, see [Layouts](/docs/frontend/layouts).
