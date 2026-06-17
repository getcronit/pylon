// The front gateway service — delegates to TWO separate remotes via TWO gateways:
// the users service (Query.user) and the orgs service (Query.org). The `User` patch
// enriches a user with `org` by delegating to the OTHER service's gateway — proving
// cross-service composition inside a patch. Registries come from `pylon pull` (both
// export `RemoteRegistry`, so they're aliased on import).
import {Pylon, createGateway} from '@getcronit/pylon'
import type {RemoteRegistry as UsersRegistry} from './generated/users'
import type {RemoteRegistry as OrgsRegistry} from './generated/orgs'

const fwd = (ctx: any) => ({authorization: ctx?.req?.header('authorization') ?? ''})

// second gateway → a DIFFERENT remote service
const orgs = createGateway<OrgsRegistry>().configure({
  url: process.env.ORGS_URL ?? 'http://localhost:4904/graphql',
  headers: fwd
})

const users = createGateway<UsersRegistry>().configure({
  url: process.env.REMOTE_URL ?? 'http://localhost:4901/graphql',
  headers: fwd,
  patches: {
    User: u => ({
      ...u,
      fullName: `${u.firstName} ${u.lastName}`,
      // delegate to the OTHER service (the orgs gateway), lazily, when `org` is selected
      org: () => orgs.delegate('Query.org', {args: {id: u.orgId}, needs: {id: true, name: true}})
    })
  }
})

export default new Pylon({
  graphql: {
    Query: {
      fullUser: (id: string) =>
        users.delegate('Query.user', {
          args: {id},
          needs: {id: true, email: true, firstName: true, lastName: true, orgId: true, seenAuth: true}
        })
    }
  }
})
