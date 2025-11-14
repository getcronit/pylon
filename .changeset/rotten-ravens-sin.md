---
'@getcronit/pylon': minor
---

Add `usePages` plugin to support file-based (Fullstack React) routing. https://github.com/getcronit/pylon/issues/69

```ts
import {app, usePages, PylonConfig} from '@getcronit/pylon'

export const graphql = {
  Query: {
    hello: () => {
      return 'Hello, world!'
    },
    post: (slug: string) => {
      return {title: `Post: ${slug}`, content: 'This is a blog post.'}
    }
  }
}

export const config: PylonConfig = {
  plugins: [usePages()] // Enables the Pages Router
}

export default app
```
