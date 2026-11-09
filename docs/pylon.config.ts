import {type PylonConfig, useNodeServer} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'

// The built entry is pure (`export default app`) — serving is explicit + app-owned.
// `useNodeServer()` (a 'last' plugin, ordered AFTER usePages so the port binds only
// once the catch-all is mounted) binds node:http on PORT || 3000 in production; it
// no-ops under `pylon dev`, where the dev server owns serving.
export default {
  plugins: [usePages(), useNodeServer()]
} satisfies PylonConfig
