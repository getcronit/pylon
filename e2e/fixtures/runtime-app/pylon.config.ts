import type {PylonConfig} from '@getcronit/pylon'
import {useNodeServer} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon/db/plugin'
// The ORM connects via the runtime plugin (setup runs before the app serves),
// instead of a manual db.connect() in the entry.
export default {
  plugins: [useDatabase(), useNodeServer()]
} satisfies PylonConfig
