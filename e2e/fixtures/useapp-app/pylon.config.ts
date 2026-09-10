import type {PylonConfig} from '@getcronit/pylon'
import {useNodeServer} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon/auth/plugin'
import {useDatabase} from '@getcronit/pylon/db/plugin'
import {headerAuth} from './src/identity'
// Infra once: identity binds the Principal; bare useDatabase() derives the
// connection + tenant from it. Routes + resolvers read this one context.
// The generated .pylon/server.mjs owns HTTP serving.
export default {
  plugins: [useIdentity(headerAuth), useDatabase(), useNodeServer()]
} satisfies PylonConfig
