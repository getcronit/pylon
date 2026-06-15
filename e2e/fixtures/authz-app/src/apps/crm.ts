// CRM app: capability gate (the 'crm' role) + tenant-scoped, deny-by-default model
// with owner/shared row abilities, an instance-authorize update, and a PBAC-gated
// export op.
import {Pylon} from '@getcronit/pylon'
import {hasPermission, hasRole} from '@getcronit/pylon-auth'
import {authorize, db, defineAbilities, gate, models} from '@getcronit/pylon-db'

const crm_ = models.app('crm', {tenant: 'orgId', secure: true})

@crm_.model() // → crm_contact
export class Contact extends crm_.Model {
  static objects = db.manager(Contact)
  id = crm_.ID()
  orgId = crm_.Text()
  ownerId = crm_.Text()
  shared = crm_.Boolean({default: false})
  name = crm_.Text()
  email = crm_.Text({nullable: true})
}

// Row abilities (RBAC admin + ABAC owner/shared). Accumulates with billing's.
defineAbilities((p, can) => {
  const uid = p?.id ?? '__anon__'
  if (hasRole(p, 'admin')) can('manage', 'all')
  can('read', Contact, {OR: [{ownerId: uid}, {shared: true}]})
  can('update', Contact, {ownerId: uid})
  if (p)
    can('create', Contact).stamp(c => {
      c.orgId = String(p.tenant)
      c.ownerId = String(p.id)
    })
})

export const crm = new Pylon({
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
