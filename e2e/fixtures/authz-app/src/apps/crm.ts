// CRM app: capability gate (the 'crm' role) + tenant-scoped, deny-by-default model
// with owner/shared row abilities, an instance-authorize update, and a PBAC-gated
// export op.
import {Pylon} from '@getcronit/pylon'
import {hasPermission, hasRole, type Principal} from '@getcronit/pylon/auth'
import {authorize, db, gate, models} from '@getcronit/pylon/db'

// Decorator-free: plain model; the app names it (→ crm_contact) + sets tenant/secure.
// The model's OWN owner/shared row rules are co-located in `static abilities`.
export class Contact extends models.Model {
  static objects = db.manager(Contact)
  id = models.ID()
  orgId = models.Text()
  ownerId = models.Text()
  shared = models.Boolean({default: false})
  name = models.Text()
  email = models.Text({nullable: true})

  static abilities(p: Principal | undefined, can: any) {
    const uid = p?.id ?? '__anon__'
    can('read', {OR: [{ownerId: uid}, {shared: true}]})
    can('update', {ownerId: uid})
    if (p)
      can('create').stamp((c: Contact) => {
        c.orgId = String(p.tenant)
        c.ownerId = String(p.id)
      })
  }
}

export const crm = new Pylon({
  name: 'crm',
  db: {
    models: [Contact],
    tenant: 'orgId',
    secure: true,
    // CROSS-ENTITY rule (admin → anything) → the app's db config.
    abilities: (p, can) => {
      if (hasRole(p, 'admin')) can('manage', 'all')
    }
  },
  graphql: {
    Query: {
      // ability- + tenant-scoped automatically
      contacts: (): Promise<Contact[]> => Contact.objects.orderBy('name').all()
    },
    Mutation: {
      addContact: (name: string, shared: boolean): Promise<Contact> =>
        Contact.objects.create({name, shared}),
      renameContact: async (id: number, name: string): Promise<Contact> => {
        const c = await Contact.objects.get({id})
        authorize('update', c) // resource ability — owner (or admin) only
        c.name = name
        await c.$save()
        return c
      },
      exportContacts: async (): Promise<number> => {
        authorize(p => hasPermission(p, 'crm:export')) // PBAC resolver check
        return (await Contact.objects.all()).length
      }
    }
  },
  gate: gate({authorize: p => hasRole(p, 'crm')}) // app capability floor
})
