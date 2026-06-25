// notes app — demonstrates row-level authorization via definePolicy. A Note is
// owned by a user; readable by its owner (or anyone if `shared`), an ADMIN sees
// all; writable only by its owner. The principal is bound per request from
// headers (see host index.ts + pylon.config.ts).
import {Pylon} from '@getcronit/pylon'
import {db, models} from '@getcronit/pylon-db'

interface Principal {
  userId: number
  role?: 'USER' | 'ADMIN'
}

// Decorator-free plain model; the app names it (→ notes_note) + groups its migrations.
export class Note extends models.Model {
  static objects = db.manager(Note)
  id = models.ID()
  title = models.Text()
  ownerId = models.Int()
  shared = models.Boolean({default: false})
}

export const notes = new Pylon({name: 'notes', db: {models: [Note]}})

// Row-level policy (the policy system — distinct from abilities) stays as-is.
db.definePolicy(Note, {
  read: ({principal}) => {
    const p = principal as Principal | undefined
    return p?.role === 'ADMIN' ? {} : {OR: [{ownerId: p?.userId ?? -1}, {shared: true}]}
  },
  update: ({principal}) => ({ownerId: (principal as Principal | undefined)?.userId ?? -1}),
  delete: ({principal}) => ({ownerId: (principal as Principal | undefined)?.userId ?? -1}),
  create: ({principal}) => !!principal,
  onCreate: ({principal}, note) => {
    ;(note as Note).ownerId = (principal as Principal).userId // stamp owner; never trust input
  }
})
