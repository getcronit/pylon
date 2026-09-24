// Stage 1 fixture: each "app" is a Pylon with its own typed GraphQL fragment; the
// root composes them. The point of this fixture is the BUILD — proving that
// `export const graphql = new Pylon().compose(...).graphql` is type-introspected by
// the real `pylon build` into ONE merged schema (the deep intersection of each
// child Pylon's fragment), exactly as the legacy free `compose()` does.
import {Pylon} from '@getcronit/pylon'
import {billing} from './apps/billing'
import {catalog} from './apps/catalog'

// Single export: the app IS the contract. The compiler reads `default.graphql`.
export default new Pylon().compose(catalog, billing)
