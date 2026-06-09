// A real, runnable Node Pylon app backed by Postgres via the ORM. The runtime
// e2e builds this, starts the server, and fires GraphQL queries to prove the
// whole stack works at runtime: resolver wrapping, model hydration, relation
// resolution, and create/get against a live database.
import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'
import {
  Model,
  model,
  id,
  text,
  foreignKey,
  hasMany,
  connect,
  syncSchema
} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

@model()
export class Author extends Model {
  id = id()
  name = text()
  books = hasMany(() => Book, {foreignKey: 'authorId'})
}

@model()
export class Book extends Model {
  id = id()
  title = text()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
}

export const graphql = {
  Query: {
    author: (id: number): Promise<Author> => Author.get({id}),
    authors: (): Promise<Author[]> => Author.all()
  },
  Mutation: {
    createAuthor: (name: string): Promise<Author> => Author.create({name}),
    addBook: (authorId: number, title: string): Promise<Book> =>
      Book.create({authorId, title})
  }
}

// Runtime-only side effects — stripped during build-time model loading.
connect({connectionString: process.env.DATABASE_URL as string})
await syncSchema()
serve({fetch: app.fetch, port: Number(process.env.PORT ?? 3000)}, info => {
  console.log(`ready:${info.port}`)
})
