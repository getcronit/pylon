// Inferred polymorphic delegate — NO return-type annotation, so the field type is
// the inferred variant union. The key is `as const` on each `__typename`: it keeps
// the discriminant a string LITERAL, which the builder uses to name the members
// (DoctorProfile / PatientProfile) and synthesize their shared interface. With the
// literal discriminant this is unambiguous valid TypeScript and the builder emits a
// valid polymorphic schema (no annotation needed). Build is pure type introspection
// — no remote call — so no server is needed.
//
// (Without `as const` the discriminant widens to `string`, the members become
//  indistinguishable by name, and the schema is invalid → the build fails loud. See
//  the schema-invalid-app fixture + schema-invalid-fail-loud test for that case.)
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
        ? {__typename: 'DoctorProfile' as const, id: u.id, email: u.email, specialty: u.specialty}
        : {__typename: 'PatientProfile' as const, id: u.id, email: u.email, insuranceId: u.insuranceId}
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
