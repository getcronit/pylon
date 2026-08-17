import type {PylonConfig} from '@getcronit/pylon'
import {useNodeServer} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon/db/plugin'

// The generated `server.mjs` self-serves on Node, so the config just wires the
// ORM. useDatabase connects from DATABASE_URL. The app opts into global ids +
// its namespace via the top-level `node: {namespace: 'shop'}` option (see src) —
// gids come out as `gid://shop/Note/<snowflake>`. nodeId is leased from the DB
// (multi-instance safe).
export default {
  plugins: [useDatabase({nodeId: 'lease'}), useNodeServer()]
} satisfies PylonConfig
