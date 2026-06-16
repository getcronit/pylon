import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon-db'
import {serveLast} from '../_serve-plugin'

// The ORM connects via the runtime plugin (setup runs before the app serves),
// instead of a manual db.connect() in the entry. serveLast owns HTTP serving.
export default {
  plugins: [useDatabase(), serveLast()]
} satisfies PylonConfig
