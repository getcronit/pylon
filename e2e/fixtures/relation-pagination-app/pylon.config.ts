import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon-db'
import {serveLast} from '../_serve-plugin'

export default {plugins: [useDatabase(), serveLast()]} satisfies PylonConfig
