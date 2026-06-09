/**
 * A real Pylon entrypoint built on real `@getcronit/pylon-orm` models. It is
 * never executed — Pylon's `SchemaBuilder` compiles it with the TypeScript
 * compiler and derives the GraphQL schema from the resolver return types. The
 * integration test asserts on the emitted SDL, exercising the ACTUAL ORM types
 * against the ACTUAL schema introspection (no mirrored predicates).
 */
import {Model, model, id, text, boolean, timestamp, foreignKey, hasMany} from '../../../src/index.js'
import type {Relation, RelatedManager} from '../../../src/index.js'

@model()
export class User extends Model {
  id = id()
  email = text({unique: true})
  isActive = boolean({default: true})
  createdAt = timestamp({defaultSql: 'now()'})
  posts = hasMany(() => Post, {foreignKey: 'authorId'})
  // Hidden column: `$` is not a valid GraphQL field char → excluded from schema.
  $passwordHash = text({nullable: true})
}

@model()
export class Post extends Model {
  id = id()
  title = text()
  authorId = foreignKey(() => User)
  declare author: Relation<User>
}

export const graphql = {
  Query: {
    user: (): Promise<User> => null as unknown as Promise<User>,
    users: (): Promise<User[]> => null as unknown as Promise<User[]>
  },
  Mutation: {}
}
