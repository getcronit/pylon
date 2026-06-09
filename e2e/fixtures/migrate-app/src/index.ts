// App for the migration-CLI e2e. Distinct table names (mig_*).
import {models} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

@models.model({table: 'mig_author'})
export class MigAuthor extends models.Model {
  id = models.ID()
  name = models.Text({unique: true})
  books = models.HasMany(() => MigBook, {foreignKey: 'authorId'})
}

@models.model({table: 'mig_book'})
export class MigBook extends models.Model {
  id = models.ID()
  title = models.Text()
  authorId = models.ForeignKey(() => MigAuthor)
  declare author: Relation<MigAuthor>
}

export const graphql = {
  Query: {},
  Mutation: {}
}
