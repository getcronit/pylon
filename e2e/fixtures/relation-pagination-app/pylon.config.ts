import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon/db/plugin'
import {serveLast} from '../_serve-plugin'

export default {plugins: [useDatabase(), serveLast()]} satisfies PylonConfig
