// Build-only fixture that produces an INVALID GraphQL schema, to prove `pylon build`
// fails loudly instead of writing it. This is the AMBIGUOUS polymorphic case: the
// delegate has no return-type annotation AND the patch's `__typename` is NOT `as
// const`, so it widens to `string`. With no literal discriminant the inferred variant
// members can't be named/distinguished, they collide with the declared classes, and
// the schema fails validation. (Adding `as const` to each `__typename` — or annotating
// the resolver — makes it valid; see gateway-poly-inferred-app.) The build introspects
// types only — no remote call — so no server is needed.
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
