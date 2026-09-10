import type {PylonConfig} from '@getcronit/pylon'
import {useNodeServer} from '@getcronit/pylon'
import {hasRole} from '@getcronit/pylon/auth'
import {useIdentity} from '@getcronit/pylon/auth/plugin'
import {useDatabase} from '@getcronit/pylon/db/plugin'
import {headerAuth} from './src/identity'

// The acting-tenant GATE (§3 of rfcs/ACTING_TENANT.md). `operationContext` runs per
// operation, inside that op's execution scope. It honours `context.actingTenant` ONLY for a
// SUPER_ADMIN — for anyone else it returns `base` unchanged, so a bare value grants nothing
// (deny-by-default). Pylon never infers this gate; it just applies whatever we return.
export default {
  plugins: [
    useIdentity(headerAuth),
    useDatabase({
      operationContext: async (base, op) => {
        const acting = op.context.actingTenant
        if (!acting) return base // no request → own tenant
        // GATE: privilege check. Non-SUPER_ADMIN acting is ignored, never widened.
        if (!hasRole(base.principal as any, 'SUPER_ADMIN')) return base
        // A real app would also validate the tenant exists and load its FeatureState here;
        // for the fixture, rebinding the tenant is what we assert.
        return {...base, tenant: acting}
      }
    }),
    useNodeServer()
  ]
} satisfies PylonConfig
