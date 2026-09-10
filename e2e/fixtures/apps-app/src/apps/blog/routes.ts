// blog app — Hono routes. A plain function the host calls with the app.
import type {app} from '@getcronit/pylon'

export function registerBlogRoutes(a: typeof app) {
  a.get('/blog/ping', c => c.text('blog-pong'))
}
