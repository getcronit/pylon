// An ORM app that opts into global ids (`db.globalIds`). Every Note gets a
// snowflake PK (`id({snowflake:true})`), exposed on the wire as a
// `gid://<ns>/Note/<snowflake>` (namespace + node id come from useDatabase); the
// build adds the `Node` interface + a root `node(id)` refetch field.
import {Pylon} from '@getcronit/pylon'
import {db, models} from '@getcronit/pylon-db'

export class Note extends models.Model {
  static objects = db.manager(Note)
  id = models.ID({snowflake: true})
  title = models.Text()
}

export default new Pylon({
  db: {models: [Note], globalIds: true},
  graphql: {
    Query: {
      notes: (): Promise<Note[]> => Note.objects.all(),
      // A hand-written get-by-id: the client passes back the gid the API emitted,
      // and the ORM decodes it to the raw local id — the resolver "sees the number".
      note: (id: string): Promise<Note> => Note.objects.get({id})
    },
    Mutation: {
      addNote: (title: string): Promise<Note> => Note.objects.create({title})
    }
  }
})
