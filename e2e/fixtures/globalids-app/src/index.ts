// An ORM app that opts into global ids (top-level `node: true`). Every entity gets a
// snowflake PK (`id({snowflake:true})`), exposed on the wire as a
// `gid://<ns>/Type/<snowflake>` (namespace + node id come from useDatabase); the
// build adds the `Node` interface + a root `node(id)` refetch field.
//
// This fixture also exercises the gid INPUT boundary: the `ID` scalar decodes a
// `gid://…` back to the raw local id on EVERY id-typed input, so a client can
// hand a gid it was given straight back into a foreign-key or many-to-many write
// — the paths that would otherwise store a `gid://…` string and violate a FK.
import {Pylon, type ID} from '@getcronit/pylon'
import {db, models, type Relation} from '@getcronit/pylon-db'

export class Author extends models.Model {
  static objects = db.manager(Author)
  id = models.ID({snowflake: true})
  name = models.Text()
}

export class Tag extends models.Model {
  static objects = db.manager(Tag)
  id = models.ID({snowflake: true})
  label = models.Text()
}

export class Note extends models.Model {
  static objects = db.manager(Note)
  id = models.ID({snowflake: true})
  title = models.Text()
  // A foreign key: the client passes back the AUTHOR's gid, decoded to the raw id.
  authorId = models.ForeignKey(() => Author, {nullable: true})
  declare author: Relation<Author>
  // A many-to-many: linking passes back a TAG gid, decoded before the join write.
  tags = models.ManyToMany(() => Tag)
}

export default new Pylon({
  db: {models: [Note, Author, Tag]},
  node: true,
  graphql: {
    Query: {
      notes: (): Promise<Note[]> => Note.objects.all(),
      // A hand-written get-by-id: the client passes back the gid the API emitted.
      // Typing the arg as `ID` opts it into the scalar's gid-decode, so the
      // resolver "sees the number".
      note: (id: ID): Promise<Note> => Note.objects.get({id})
    },
    Mutation: {
      addAuthor: (name: string): Promise<Author> => Author.objects.create({name}),
      addTag: (label: string): Promise<Tag> => Tag.objects.create({label}),
      addNote: (title: string): Promise<Note> => Note.objects.create({title}),
      // FK-by-gid: `authorId` is an `ID` input → the gid is decoded to the raw
      // local id before the insert, so the foreign key resolves.
      addNoteFor: (title: string, authorId: ID): Promise<Note> =>
        Note.objects.create({title, authorId}),
      // m2m-by-gid: both ids are `ID` inputs → decoded before the join-row write.
      linkTag: async (noteId: ID, tagId: ID): Promise<Note> => {
        const note = await Note.objects.get({id: noteId})
        await note.tags.add(tagId)
        return note
      }
    }
  }
})
