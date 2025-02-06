---
'@getcronit/pylon': minor
---

Extend plugin system with middleware and app setup support.
The viewer is now integrated via a built-in `useViewer` plugin.

Custom plugins can now acces the app instance and register middleware and setup functions.:

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
    }
  }
}
```
