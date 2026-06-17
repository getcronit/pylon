import {type Plugin, type PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon-pages/plugin'
import {serve} from '@hono/node-server'

// Serving is the app's job now — the framework only boots. This 'last'-strategy
// plugin starts listening after every route (incl. usePages' catch-all) is
// mounted, so keep it last in the plugins array.
const serveLast = (): Plugin => ({
  name: 'serve',
  strategy: 'last',
  setup: app => {
    serve(
      {fetch: app.fetch, port: Number(process.env.PORT) || 3000},
      info => console.log(`Pylon docs running at http://localhost:${info.port}`)
    )
  }
})

export default {
  plugins: [usePages(), serveLast()]
} satisfies PylonConfig
