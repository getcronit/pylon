import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon/auth/plugin'
import {useDatabase} from '@getcronit/pylon/db/plugin'
import {headerAuth} from './src/identity'
import {serveLast} from '../_serve-plugin'

// Infra once: identity binds the Principal; bare useDatabase() derives the
// connection + tenant from it. Routes + resolvers read this one context.
// serveLast owns HTTP serving (the framework only boots the app).
export default {
  plugins: [useIdentity(headerAuth), useDatabase(), serveLast()]
} satisfies PylonConfig
