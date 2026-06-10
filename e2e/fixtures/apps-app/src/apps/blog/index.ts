// blog app — inits the app scope and declares its models.
import {models, db} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

export const blog = models.app('blog')

@blog.model() // → table "blog_author" (app prefix + snake_case class)
export class Author extends blog.Model {
  static objects = db.manager(Author)
  id = blog.ID()
  name = blog.Text({min: 2})
  articles = blog.HasMany(() => Article, {foreignKey: 'authorId'})
}

@blog.model() // → table "blog_article"
export class Article extends blog.Model {
  static objects = db.manager(Article)
  id = blog.ID()
  title = blog.Text()
  authorId = blog.ForeignKey(() => Author)
  declare author: Relation<Author>
}
