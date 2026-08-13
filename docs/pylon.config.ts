import {type PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'

// The generated `.pylon/server.mjs` self-serves on Node — it binds a node:http
// server (PORT || 3000) AFTER every route is mounted. So the config only wires
// plugins; it must NOT add its own serve plugin, or the two double-bind the port
// (EADDRINUSE). See packages/pylon-dev/src/builder/bundler/emit-server-glue.ts.
export default {
  plugins: [usePages()]
} satisfies PylonConfig
