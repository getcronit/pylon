// Runnable Node Pylon app backed by Postgres — the runtime e2e exercises it.
// The framework owns serving (the generated entry serves this default export).
import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

@models.model()
export class Author extends models.Model {
  static objects = db.manager(Author)
  id = models.ID()
  name = models.Text({min: 2})
  books = models.HasMany(() => Book, {foreignKey: 'authorId'})
}

@models.model()
export class Book extends models.Model {
  static objects = db.manager(Book)
  id = models.ID()
  title = models.Text()
  authorId = models.ForeignKey(() => Author)
  declare author: Relation<Author>
}

export default new Pylon({
  graphql: {
    Query: {
      author: (id: number): Promise<Author> => Author.objects.get({id}),
      authors: (): Promise<Author[]> => Author.objects.all()
    },
    Mutation: {
      createAuthor: (name: string): Promise<Author> => Author.objects.create({name}),
      addBook: (authorId: number, title: string): Promise<Book> =>
        Book.objects.create({authorId, title})
    }
  }
})
