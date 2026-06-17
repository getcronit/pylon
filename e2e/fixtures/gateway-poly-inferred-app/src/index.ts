// TDD TARGET (currently fails — builder bug). Declared interface classes PLUS a
// polymorphic delegate left WITHOUT a return-type annotation, so the field type is
// the INFERRED variant union. This is valid TypeScript, so the builder must emit a
// VALID GraphQL schema — never an invalid one. Today it doesn't: two interface-
// synthesis paths collide (inheritance `IProfile` vs the union's `Profile`), the
// union members get shape-merged into the class types, and the result fails schema
// validation. The build is pure type introspection — no remote call — so no server
// is needed to reproduce it.
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
      // No return annotation — the field type is inferred from the patch's union.
      profile: (id: string) =>
        users.delegate('Query.user', {
          args: {id},
          needs: {id: true, email: true, kind: true, specialty: true, insuranceId: true}
        })
    }
  }
})
