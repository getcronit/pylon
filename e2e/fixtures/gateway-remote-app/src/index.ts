// The "remote" user-management service — a real Pylon app, built + served by the
// CLI, that the front delegates to. `seenAuth` echoes the auth header THIS service
// received, so the front can prove header forwarding end-to-end.
import {Pylon, getContext} from '@getcronit/pylon'

export class User {
  id!: string
  email!: string
  firstName!: string
  lastName!: string
  seenAuth(): string {
    return getContext()?.req.header('authorization') ?? ''
  }
}

const DB: Record<string, {id: string; email: string; firstName: string; lastName: string}> = {
  u1: {id: 'u1', email: 'ada@x.com', firstName: 'Ada', lastName: 'Lovelace'}
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
