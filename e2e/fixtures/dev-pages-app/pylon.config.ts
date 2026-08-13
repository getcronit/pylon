import type {PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'
import {serveLast} from '../_serve-plugin'

// serveLast is ordered AFTER usePages so it listens once the catch-all is mounted.
export default {plugins: [usePages(), serveLast()]} satisfies PylonConfig
