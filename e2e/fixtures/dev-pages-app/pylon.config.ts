import type {PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'

// The generated `.pylon/server.mjs` self-serves on Node (binds node:http on
// PORT || 3000 after every route is mounted), so the config only wires plugins —
// it must NOT add its own serve plugin, or the two double-bind the port
// (EADDRINUSE). See packages/pylon/src/cli/builder/bundler/emit-server-glue.ts.
export default {plugins: [usePages()]} satisfies PylonConfig
