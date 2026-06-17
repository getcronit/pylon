// Build-only fixture that deliberately produces an INVALID GraphQL schema, to prove
// `pylon build` fails loudly instead of writing it. The polymorphic delegate is left
// WITHOUT a return-type annotation, so the inferred variant union is emitted as
// anonymous types that collide with the declared classes (interface member missing a
// field). The build introspects types only — no remote call — so no server is needed.
import {Pylon, createGateway} from '@getcronit/pylon'
import type {RemoteRegistry as UsersRegistry} from './generated/remote'

export class Profile {
  id!: string
  email!: string
}
export class DoctorProfile extends Profile {
  specialty!: string
}
export class PatientProfile extends Profile {
  insuranceId!: string
}

const users = createGateway<UsersRegistry>().configure({
  url: 'http://unused.local/graphql',
  patches: {
    User: u =>
      u.kind === 'doctor'
        ? {__typename: 'DoctorProfile', id: u.id, email: u.email, specialty: u.specialty}
        : {__typename: 'PatientProfile', id: u.id, email: u.email, insuranceId: u.insuranceId}
  }
})

export default new Pylon({
  graphql: {
    Query: {
      // BUG ON PURPOSE: no return annotation → invalid schema.
      profile: (id: string) =>
        users.delegate('Query.user', {
          args: {id},
          needs: {id: true, email: true, kind: true, specialty: true, insuranceId: true}
        })
    }
  }
})
