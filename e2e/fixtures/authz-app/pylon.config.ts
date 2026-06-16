import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {headerAuth} from './src/identity'
import {serveLast} from '../_serve-plugin'

// identity → Principal; useDatabase derives connection + tenant from it (default)
// and resolves the tenant's feature plan from x-features. serveLast owns serving.
export default {
  plugins: [
    useIdentity(headerAuth),
    useDatabase({
      features: c => (c.req.header('x-features') ?? '').split(',').filter(Boolean)
    }),
    serveLast()
  ]
} satisfies PylonConfig
