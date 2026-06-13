import type {PylonConfig} from '@getcronit/pylon'
import {useApp} from '@getcronit/pylon-app'
import {composed} from './src/apps'
import {headerAuth} from './src/identity'

// One declaration secures GraphQL + REST + ORM: useIdentity(headerAuth) binds the
// Principal → useDatabase binds tenant/principal into the ORM Context → routes
// mount, each gated by its app.
export default {
  plugins: [...useApp(composed, {identity: headerAuth})]
} satisfies PylonConfig
