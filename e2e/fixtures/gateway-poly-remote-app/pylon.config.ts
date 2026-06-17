import type {PylonConfig} from '@getcronit/pylon'
import {serveLast} from '../_serve-plugin'
export default {plugins: [serveLast()]} satisfies PylonConfig
