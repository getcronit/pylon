import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon-db'

export default {
  plugins: [useDatabase()]
} satisfies PylonConfig
