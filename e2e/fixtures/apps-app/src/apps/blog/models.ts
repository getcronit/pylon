// blog app — models. Tables are app-namespaced (blog_*).
import {models, db} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

@models.model({table: 'blog_author'})
export class Author extends models.Model {
  static objects = db.manager(Author)
  id = models.ID()
  name = models.Text({min: 2})
  articles = models.HasMany(() => Article, {foreignKey: 'authorId'})
}

@models.model({table: 'blog_article'})
export class Article extends models.Model {
  static objects = db.manager(Article)
  id = models.ID()
  title = models.Text()
  authorId = models.ForeignKey(() => Author)
  declare author: Relation<Author>
}
