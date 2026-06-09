// App for the migration-CLI e2e. Distinct table names (mig_*) so it never
// collides with the runtime-app fixture against the shared e2e Postgres.
import {Model, model, id, text, foreignKey, hasMany} from '@getcronit/pylon-orm'
import type {Relation} from '@getcronit/pylon-orm'

@model({table: 'mig_author'})
export class MigAuthor extends Model {
  id = id()
  name = text({unique: true})
  books = hasMany(() => MigBook, {foreignKey: 'authorId'})
}

@model({table: 'mig_book'})
export class MigBook extends Model {
  id = id()
  title = text()
  authorId = foreignKey(() => MigAuthor)
  declare author: Relation<MigAuthor>
}

export const graphql = {
  Query: {},
  Mutation: {}
}
