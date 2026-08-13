// App for the migration-CLI e2e. Distinct table names (mig_*).
import {Pylon} from '@getcronit/pylon'
import {models, type ModelConfig} from '@getcronit/pylon/db'
import type {Relation} from '@getcronit/pylon/db'

export class MigAuthor extends models.Model {
  static config = {table: 'mig_author'} satisfies ModelConfig<MigAuthor>
  id = models.ID()
  name = models.Text({unique: true})
  books = models.HasMany(() => MigBook, {foreignKey: 'authorId'})
}

export class MigBook extends models.Model {
  static config = {table: 'mig_book'} satisfies ModelConfig<MigBook>
  id = models.ID()
  title = models.Text()
  authorId = models.ForeignKey(() => MigAuthor)
  declare author: Relation<MigAuthor>
}

export default new Pylon({
  db: {models: [MigAuthor, MigBook]},
  graphql: {
    Query: {},
    Mutation: {}
  }
})
