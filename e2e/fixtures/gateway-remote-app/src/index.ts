// The "remote" user-management service — a real Pylon app, built + served by the
// CLI. `seenAuth` echoes the auth header THIS service received (proves header
// forwarding). `orgId` lets the front enrich a user from a SEPARATE orgs service.
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

const DB: Record<string, {id: string; email: string; firstName: string; lastName: string; orgId: string}> = {
  u1: {id: 'u1', email: 'ada@x.com', firstName: 'Ada', lastName: 'Lovelace', orgId: 'org1'}
}

export default new Pylon({
  graphql: {
    Query: {
      user: (id: string): User | null => {
        const row = DB[id]
        return row ? Object.assign(new User(), row) : null
      }
    }
  }
})
