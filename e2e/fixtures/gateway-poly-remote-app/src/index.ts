// The polymorphic "user-management" remote. A single flat `User` carries a
// discriminator (`kind`) plus the union of all variant fields (doctor-only
// `specialty`, patient-only `insuranceId`), each nullable. The front gateway
// patches this flat type into a polymorphic interface by stamping `__typename`
// off `kind` — so this service stays a plain, non-polymorphic source.
import {Pylon} from '@getcronit/pylon'

export class User {
  id!: string
  email!: string
  kind!: string // 'doctor' | 'patient' — the discriminator
  specialty!: string | null // doctor-only
  insuranceId!: string | null // patient-only
}

const DB: Record<string, {id: string; email: string; kind: string; specialty: string | null; insuranceId: string | null}> = {
  u1: {id: 'u1', email: 'ada@x.com', kind: 'doctor', specialty: 'Cardiology', insuranceId: null},
  u2: {id: 'u2', email: 'lin@x.com', kind: 'patient', specialty: null, insuranceId: 'INS-42'}
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
