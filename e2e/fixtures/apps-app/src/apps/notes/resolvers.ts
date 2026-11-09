// notes app — resolvers. Every read/write goes through the row-level policy
// (definePolicy) automatically; no manual auth checks here. `notesAsSystem`
// shows the `.unscoped()` bypass for trusted/admin paths.
import {Note} from './index.js'

export const Query = {
  notes: (): Promise<Note[]> => Note.objects.orderBy('title').all(), // policy-scoped
  notesAsSystem: (): Promise<Note[]> => Note.objects.unscoped().orderBy('title').all()
}

export const Mutation = {
  // ownerId is stamped by the policy's onCreate; create is gated to authenticated principals.
  createNote: (title: string, shared?: boolean): Promise<Note> =>
    Note.objects.create({title, shared: shared ?? false}),
  // get() is read-scoped (NotFound if invisible); $save() is update-scoped
  // (ForbiddenError if visible-but-not-owned).
  renameNote: async (id: number, title: string): Promise<Note> => {
    const note = await Note.objects.get({id})
    note.title = title
    await note.$save()
    return note
  }
}
