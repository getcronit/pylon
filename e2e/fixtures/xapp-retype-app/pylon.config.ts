import type {PylonConfig} from '@getcronit/pylon'
import {useNodeServer} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon/db/plugin'
export default {plugins: [useDatabase(), useNodeServer()]} satisfies PylonConfig
