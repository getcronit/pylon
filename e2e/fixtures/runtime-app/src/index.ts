// Runnable Node Pylon app backed by Postgres — the runtime e2e exercises it.
import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'
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

export const graphql = {
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

// Runtime-only side effects — stripped during build-time model loading. The DB
// connection is opened by useDatabase() (pylon.config.ts) before the app serves.
// Schema is provisioned out-of-band by `pylon db deploy` (real migration path),
// NOT syncSchema — so the app just serves.
serve({fetch: app.fetch, port: Number(process.env.PORT ?? 3000)}, info => {
  console.log(`ready:${info.port}`)
})
