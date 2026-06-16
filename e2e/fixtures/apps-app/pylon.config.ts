import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon-db'
import {serveLast} from '../_serve-plugin'

export default {
  plugins: [
    serveLast(),
    useDatabase({
      // Test-only auth: derive the principal from request headers (the plugin
      // passes the Hono context). Real apps would read `c.get('session')` set by
      // an auth middleware.
      principal: c => {
        const id = c.req.header('x-user-id')
        return id ? {userId: Number(id), role: c.req.header('x-role') ?? 'USER'} : undefined
      }
    })
  ]
} satisfies PylonConfig
