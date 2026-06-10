import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon-db'

// The ORM connects via the runtime plugin (setup runs before the app serves),
// instead of a manual db.connect() in the entry.
export default {
  plugins: [useDatabase()]
} satisfies PylonConfig
