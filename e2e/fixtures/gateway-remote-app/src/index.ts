// The "remote" user-management service — a real Pylon app, built + served by the
// CLI, that the front delegates to. `seenAuth` echoes the auth header THIS service
// received, so the front can prove header forwarding end-to-end. It also exposes
// an `org(id)` query so the front can verify a PATCH adding a delegating field.
import {Pylon, getContext} from '@getcronit/pylon'

export class User {
  id!: string
  email!: string
  firstName!: string
  lastName!: string
  orgId!: string
  seenAuth(): string {
    return getContext()?.req.header('authorization') ?? ''
  }
}

export class Org {
  id!: string
  name!: string
}

const DB: Record<string, {id: string; email: string; firstName: string; lastName: string; orgId: string}> = {
  u1: {id: 'u1', email: 'ada@x.com', firstName: 'Ada', lastName: 'Lovelace', orgId: 'org1'}
}
const ORGS: Record<string, {id: string; name: string}> = {
  org1: {id: 'org1', name: 'Acme'}
}

export default new Pylon({
  graphql: {
    Query: {
      user: (id: string): User | null => {
        const row = DB[id]
        return row ? Object.assign(new User(), row) : null
      },
      org: (id: string): Org | null => {
        const row = ORGS[id]
        return row ? Object.assign(new Org(), row) : null
      }
    }
  }
})
