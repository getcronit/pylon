import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon/auth/plugin'
import {useDatabase} from '@getcronit/pylon/db/plugin'
import {headerAuth} from './src/identity'
import {serveLast} from '../_serve-plugin'

// Root infra. useIdentity binds the Principal; bare useDatabase() now derives the
// connection + tenant FROM that Principal by default — no boilerplate. Both authz
// layers read this one context. serveLast owns HTTP serving (framework just boots).
export default {
  plugins: [useIdentity(headerAuth), useDatabase(), serveLast()]
} satisfies PylonConfig
