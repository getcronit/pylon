/**
 * A real Pylon entrypoint built on real `@getcronit/pylon-db` models. It is
 * never executed — Pylon's `SchemaBuilder` compiles it with the TypeScript
 * compiler and derives the GraphQL schema from the resolver return types. The
 * integration test asserts on the emitted SDL, exercising the ACTUAL ORM types
 * against the ACTUAL schema introspection (no mirrored predicates).
 */
import {Pylon} from '@getcronit/pylon'
import {Model, id, text, boolean, createdAt, foreignKey, hasMany, manyToMany, enumOf} from '../../../src/index.js'
import type {Relation} from '../../../src/index.js'

// A native TS string enum — usable in backend code (UserRole.ADMIN) and the
// source of the GraphQL enum's name.
export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER'
}

export class User extends Model {
  id = id()
  email = text({unique: true})
  isActive = boolean({default: true})
  createdAt = createdAt()
  // enum column: should derive as a GraphQL ENUM (UserRole), not String.
  role = enumOf(UserRole, {default: UserRole.USER})
  posts = hasMany(() => Post, {foreignKey: 'authorId'})
  // Hidden column: `$` is not a valid GraphQL field char → excluded from schema.
  $passwordHash = text({nullable: true})
}

export class Post extends Model {
  id = id()
  title = text()
  authorId = foreignKey(() => User)
  declare author: Relation<User>
  // many-to-many: should derive as a GraphQL LIST of Tag.
  tags = manyToMany(() => Tag)
}

export class Tag extends Model {
  id = id()
  label = text()
  posts = manyToMany(() => Post)
}

// Register the models (the default export stays a plain resolver object for SchemaBuilder).
new Pylon({db: {models: [User, Post, Tag]}})

// Repro for #43: a resolver returning a NULLABLE reference to a decorated ORM
// model — both directly (Query.maybeUser) and nested in a payload object
// (Mutation.updateUser → {user: User | null}). These must derive as nullable
// (`User`, no `!`), like any other `T | null`.
interface UpdateUserPayload {
  user: User | null
  ok: boolean
}

// Replicates the EXACT `mutation()` wrapper mechanism from @getcronit/pylon: a
// homomorphic mapped type that makes every payload field nullable, intersected
// with userErrors. This is the shape that (per #43) wrongly emitted `User!`.
type UserError = {message: string; field: string[] | null}
type MutationPayload<T> = {[K in keyof T]: T[K] | null} & {
  userErrors: UserError[]
}

export default {
  Query: {
    user: (): Promise<User> => null as unknown as Promise<User>,
    users: (): Promise<User[]> => null as unknown as Promise<User[]>,
    maybeUser: (): Promise<User | null> => null as unknown as Promise<User | null>
  },
  Mutation: {
    updateUser: (): Promise<UpdateUserPayload> =>
      null as unknown as Promise<UpdateUserPayload>,
    // The resolver's own return has a NON-null `user`; the wrapper maps it to
    // `User | null`. The derived schema must reflect the wrapper (nullable).
    saveUser: (): Promise<MutationPayload<{user: User}>> =>
      null as unknown as Promise<MutationPayload<{user: User}>>
  }
}
