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
  // A field whose ARGUMENT decides which rows come back — what the front's
  // `forceArgs` has to be able to constrain. Returns `id:status` strings so the
  // fixture needs no extra types.
  orders(status?: string, limit?: number): string[] {
    const all = [
      {id: 'o1', status: 'ACTIVE'},
      {id: 'o2', status: 'DRAFT'}
    ]
    const rows = status ? all.filter(o => o.status === status) : all
    return rows.slice(0, limit ?? rows.length).map(o => `${o.id}:${o.status}`)
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
