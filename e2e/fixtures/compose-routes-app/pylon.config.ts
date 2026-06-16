import type {PylonConfig} from '@getcronit/pylon'
import {serveLast} from '../_serve-plugin'

// No infra plugins — just serving (the app owns it; the framework only boots).
export default {plugins: [serveLast()]} satisfies PylonConfig
