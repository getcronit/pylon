---
title: Styling
description: Tailwind CSS v4, global styles, fonts, and static assets in a usePages app.
section: Frontend — usePages
order: 2
---

usePages has first-class support for [Tailwind CSS v4](https://tailwindcss.com).
New projects come with it configured.

## Global styles

A `globals.css` at the project root imports Tailwind and defines your theme using
Tailwind v4's CSS-first configuration — no `tailwind.config.js` needed:

```css
/* globals.css */
@import 'tailwindcss';

@theme {
  --color-brand: #38f6fc;
  --font-sans: 'Inter', system-ui, sans-serif;
}
```

Import it from the root layout so it applies everywhere:

```tsx
// pages/layout.tsx
import '../globals.css'

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

CSS is processed through your `postcss.config.js`, which uses
`@tailwindcss/postcss`:

```js
import tailwindPostCss from '@tailwindcss/postcss'

export default {
  plugins: [tailwindPostCss]
}
```

## Components and the `@/` alias

Project files resolve through the `@/` path alias, so you can import shared
components and utilities cleanly:

```tsx
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'
```

## Static assets and fonts

Files in `public/` are served at the site root. Drop in images, icons, and font
files, then reference them by path:

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter.woff2') format('woff2');
}
```

```tsx
<img src="/logo.svg" alt="Logo" />
```

That's all the wiring you need — write components, use Tailwind utilities, and
the build bundles your CSS alongside the page JavaScript.
