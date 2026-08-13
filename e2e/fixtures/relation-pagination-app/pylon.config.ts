import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon/db/plugin'
export default {plugins: [useDatabase()]} satisfies PylonConfig
