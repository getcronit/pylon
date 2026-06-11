// notes app — demonstrates row-level authorization via definePolicy. A Note is
// owned by a user; readable by its owner (or anyone if `shared`), an ADMIN sees
// all; writable only by its owner. The principal is bound per request from
// headers (see host index.ts + pylon.config.ts).
import {db, definePolicy, models} from '@getcronit/pylon-db'

export const notes = models.app('notes')

interface Principal {
  userId: number
  role?: 'USER' | 'ADMIN'
}

@notes.model() // → notes_note
export class Note extends notes.Model {
  static objects = db.manager(Note)
  id = notes.ID()
  title = notes.Text()
  ownerId = notes.Int()
  shared = notes.Boolean({default: false})
}

definePolicy(Note, {
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
