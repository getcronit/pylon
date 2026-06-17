// Polymorphic gateway probe. The remote exposes a single FLAT `User` (with a
// `kind` discriminator). Here we declare a GraphQL interface (`Profile`) + two
// members, and a patch turns each delegated `User` into the right member by
// stamping `__typename` off `kind`. resolveType (which honors `__typename`)
// then routes `... on DoctorProfile` / `... on PatientProfile`.
//
// This file tests the INTERFACE form: the members are referenced ONLY via the
// base type (`profile(): Profile`) + the runtime patch — never in a resolver
// signature of their own. The open question is whether the compiler still
// EMITS them as `implements Profile`. (See `_variantsRef` below.)
import {Pylon, createGateway} from '@getcronit/pylon'
import type {RemoteRegistry as UsersRegistry} from './generated/polyusers'

// The interface (base class) + its members.
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
  url: process.env.REMOTE_URL ?? 'http://localhost:4905/graphql',
  patches: {
    // Discriminate on `kind` → stamp the member __typename + project that
    // member's fields. The patch's return shape is the variant's shape.
    User: u =>
      u.kind === 'doctor'
        ? {__typename: 'DoctorProfile', id: u.id, email: u.email, specialty: u.specialty}
        : {__typename: 'PatientProfile', id: u.id, email: u.email, insuranceId: u.insuranceId}
  }
})

export default new Pylon({
  graphql: {
    Query: {
      // Interface form — declared return type is the base interface (nullable,
      // so a missing remote row delegates through as null).
      profile: (id: string): Profile | null =>
        users.delegate('Query.user', {
          args: {id},
          needs: {id: true, email: true, kind: true, specialty: true, insuranceId: true}
        }) as unknown as Profile | null
    }
  }
})
