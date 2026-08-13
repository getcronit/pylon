import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon/auth/plugin'
import {useDatabase} from '@getcronit/pylon/db/plugin'
import {headerAuth} from './src/identity'
// Root infra. useIdentity binds the Principal; bare useDatabase() now derives the
// connection + tenant FROM that Principal by default — no boilerplate. Both authz
// layers read this one context. The generated .pylon/server.mjs owns HTTP serving.
export default {
  plugins: [useIdentity(headerAuth), useDatabase()]
} satisfies PylonConfig
