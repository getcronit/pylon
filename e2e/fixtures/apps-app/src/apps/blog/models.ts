// blog app — models + the app scope. Kept separate from index.ts so signals.ts
// can import the model classes without a circular import (the classes must exist
// at `signals.connect(Model, …)` time).
import {models, db} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

export const blog = models.app('blog')

@blog.model() // → table "blog_author"
export class Author extends blog.Model {
  static objects = db.manager(Author)
  id = blog.ID()
  name = blog.Text({min: 2})
  articles = blog.HasMany(() => Article, {foreignKey: 'authorId'})

  // computed field — a plain method; its return type IS the GraphQL type.
  displayName(): string {
    return (this.name ?? '').toUpperCase()
  }
}

@blog.model() // → table "blog_article"
export class Article extends blog.Model {
  static objects = db.manager(Article)
  id = blog.ID()
  title = blog.Text()
  authorId = blog.ForeignKey(() => Author)
  declare author: Relation<Author>
}

@blog.model() // → table "blog_activity" — written by a signal (audit)
export class Activity extends blog.Model {
  static objects = db.manager(Activity)
  id = blog.ID()
  action = blog.Text()
  target = blog.Text()
}
