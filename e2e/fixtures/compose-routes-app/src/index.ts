// Two apps, each with its OWN Hono routes namespaced under a `basePath`, composed
// at the root. Proves `compose` mounts each child's routes at its prefix while
// still merging both GraphQL fragments into the single root `/graphql` — and that
// a route guard can `throw` a status-carrying error (mapped to its HTTP status by
// the core onError) while a PUBLIC route under the same prefix stays open.
import {Pylon} from '@getcronit/pylon'
import {ForbiddenError} from '@getcronit/pylon-db'

// vault app: routes under /vault, contributes `vaultStatus` to the schema.
const vault = new Pylon({
  graphql: {
    Query: {
      vaultStatus: (): string => 'vault-ok'
    }
  },
  basePath: '/vault'
})

// Gate ONLY /vault/files/* (selective, prefix-scoped). The guard throws a
// status-carrying error → the core onError maps it to 403 (not a bare 500).
vault.use('/files/*', async (c, next) => {
  if (c.req.header('x-key') !== 'secret') throw new ForbiddenError()
  return next()
})
vault.get('/files/:id', c => c.text(`file-${c.req.param('id')}`))
vault.get('/ping', c => c.text('vault-pong'))
vault.get('/webhook', c => c.text('webhook-ok')) // PUBLIC: not under /files/*

// admin app: routes under /admin, contributes `adminStatus`.
const admin = new Pylon({
  graphql: {
    Query: {
      adminStatus: (): string => 'admin-ok'
    }
  },
  basePath: '/admin'
})
admin.get('/ping', c => c.text('admin-pong'))

export default new Pylon().compose(vault, admin)
