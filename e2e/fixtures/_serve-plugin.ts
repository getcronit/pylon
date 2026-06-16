// Serving is the consuming app's job, NOT the framework's — the generated entry
// only BOOTS the app (plugins + GraphQL handler). A real app puts a plugin like
// this in its pylon.config; the e2e serve fixtures share it.
//
// It's a 'last'-strategy plugin so it runs in the final boot pass — AFTER the
// GraphQL handler and every other 'last' plugin (e.g. usePages' catch-all) — and
// thus only starts listening once all routes are registered (no "matcher already
// built" race). Keep it LAST in the plugins array.
import {serve} from '@hono/node-server'
import type {Plugin} from '@getcronit/pylon'

export const serveLast = (): Plugin => ({
  name: 'serve',
  strategy: 'last',
  setup: app => {
    serve(
      {fetch: app.fetch, port: Number(process.env.PORT) || 3000},
      info => console.log('ready:' + info.port)
    )
  }
})
