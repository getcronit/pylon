// Billing app: a STRONGER app gate — role 'billing' AND the 'billing' FEATURE must
// be enabled for the tenant. Tenant-scoped model; issuing needs a PBAC permission.
import {Pylon} from '@getcronit/pylon'
import {hasPermission, hasRole} from '@getcronit/pylon-auth'
import {authorize, db, defineAbilities, gate, models} from '@getcronit/pylon-db'

const billing_ = models.app('billing', {tenant: 'orgId', secure: true})

@billing_.model() // → billing_invoice
export class Invoice extends billing_.Model {
  static objects = db.manager(Invoice)
  id = billing_.ID()
  orgId = billing_.Text()
  amount = billing_.Int()
  status = billing_.Text({default: 'open'})
}

defineAbilities((p, can) => {
  if (hasRole(p, 'admin')) can('manage', 'all')
  can('read', Invoice) // any (tenant-scoped) member reads invoices
  if (p) can('create', Invoice).stamp(i => (i.orgId = String(p.tenant)))
})

export const billing = new Pylon({
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
