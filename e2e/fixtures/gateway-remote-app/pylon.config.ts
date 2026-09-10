import type {PylonConfig} from '@getcronit/pylon'
import {useNodeServer} from '@getcronit/pylon'
export default {plugins: [useNodeServer()]} satisfies PylonConfig
