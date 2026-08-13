// Billing app: a STRONGER app gate — role 'billing' AND the 'billing' FEATURE must
// be enabled for the tenant. Tenant-scoped model; issuing needs a PBAC permission.
import {Pylon} from '@getcronit/pylon'
import {hasPermission, hasRole, type Principal} from '@getcronit/pylon/auth'
import {authorize, db, gate, models} from '@getcronit/pylon/db'

// Decorator-free: plain model; the app names it (→ billing_invoice) + sets tenant/secure.
// The model's OWN rules are co-located in `static abilities` (subject implicit).
export class Invoice extends models.Model {
  static objects = db.manager(Invoice)
  id = models.ID()
  orgId = models.Text()
  amount = models.Int()
  status = models.Text({default: 'open'})

  static abilities(p: Principal | undefined, can: any) {
    can('read') // any (tenant-scoped) member reads invoices
    if (p) can('create').stamp((i: Invoice) => (i.orgId = String(p.tenant)))
  }
}

export const billing = new Pylon({
  name: 'billing',
  db: {
    models: [Invoice],
    tenant: 'orgId',
    secure: true,
    // CROSS-ENTITY rule (subject not this model) → the app's db config.
    abilities: (p, can) => {
      if (hasRole(p, 'admin')) can('manage', 'all')
    }
  },
  graphql: {
    Query: {
      invoices: (): Promise<Invoice[]> => Invoice.objects.all()
    },
    Mutation: {
      issueInvoice: async (amount: number): Promise<Invoice> => {
        authorize(p => hasPermission(p, 'billing:write')) // PBAC resolver check
        return Invoice.objects.create({amount})
      }
    }
  },
  // role + feature gate
  gate: gate({authorize: p => hasRole(p, 'billing'), feature: 'billing'})
})
