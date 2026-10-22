import type {PylonConfig} from '@getcronit/pylon'
import {useNodeServer} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon/auth/plugin'
import {useDatabase} from '@getcronit/pylon/db/plugin'
import {headerAuth} from './src/identity'
// identity → Principal; useDatabase derives connection + tenant from it (default)
// and resolves the tenant's feature plan from x-features.
export default {
  plugins: [
    useIdentity(headerAuth),
    useDatabase({
      features: c => (c.req.header('x-features') ?? '').split(',').filter(Boolean)
    })
  , useNodeServer()]
} satisfies PylonConfig
