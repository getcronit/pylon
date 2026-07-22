import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon-db'

// The generated `server.mjs` self-serves on Node, so the config just wires the
// ORM. useDatabase connects from DATABASE_URL. The app opts into global ids via
// the top-level `node: true` option (see src).
// nodeId leased from the DB (multi-instance safe), gidNamespace configured HERE
// (not env / not hardcoded): gids come out as `gid://shop/Note/<snowflake>`.
export default {
  plugins: [useDatabase({nodeId: 'lease', gidNamespace: 'shop'})]
} satisfies PylonConfig
