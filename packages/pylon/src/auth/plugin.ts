// The identity/auth CONFIG PLUGIN — exported from `@getcronit/pylon/auth/plugin`.
// The authoring API (getPrincipal, authorize, requireRole, IdentityProvider) stays
// at the `@getcronit/pylon/auth` root. `useIdentity`'s implementation lives in
// ./authz.ts (it shares helpers with those API functions); this file is the
// plugin's canonical entry point, matching the uniform `<feature>/plugin` convention.
export {useIdentity} from './authz.js'
