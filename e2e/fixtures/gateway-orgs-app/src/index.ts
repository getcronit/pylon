// A SEPARATE orgs service — a distinct remote the front reaches via a second
// gateway. Proves a patch can delegate across services, not just the same one.
import {Pylon} from '@getcronit/pylon'

export class Org {
  id!: string
  name!: string
}

const ORGS: Record<string, {id: string; name: string}> = {
  org1: {id: 'org1', name: 'Acme'}
}

export default new Pylon({
  graphql: {
    Query: {
      org: (id: string): Org | null => {
        const row = ORGS[id]
        return row ? Object.assign(new Org(), row) : null
      }
    }
  }
})
