import {useNodeServer, type PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'

export default {
  plugins: [usePages(), useNodeServer()]
} satisfies PylonConfig
