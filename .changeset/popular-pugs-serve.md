---
'@getcronit/pylon': minor
'@getcronit/pylon-dev': minor
---

Extend plugin system with setup, middleware, and build functions.
The viewer is now integrated via a built-in `useViewer` plugin.

Custom plugins can now access the app instance and register routes, middleware, and custom build steps.

```ts
import {Plugin} from '@getcronit/pylon'

export function myPlugin(): Plugin {
  return {
    setup(app) {
      app.use((req, res, next) => {
        console.log('Request:', req.url)
        next()
      })

      app.get('/hello', (req, res) => {
        res.send('Hello, World!')
      })
    },
    middleware: (c, next) => {
      // This middleware will be inserted higher in the middleware stack
      console.log('Middleware:', c.req.url)
      next()
    },
    build: async () => {
      // Custom esbuild build
      const ctx = await esbuild.context(...)

      // Must return the context
      return ctx
    }
  }
}
```
