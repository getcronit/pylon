// blog app — models + the app scope. Kept separate from index.ts so signals.ts
// can import the model classes without a circular import (the classes must exist
// at `signals.connect(Model, …)` time).
import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon/db'
import type {Relation} from '@getcronit/pylon/db'

// Decorator-free plain models; the app (below) names them (→ blog_*) + groups migrations.
export class Author extends models.Model {
  static objects = db.manager(Author)
  id = models.ID()
  name = models.Text({min: 2})
  articles = models.HasMany(() => Article, {foreignKey: 'authorId'})

  // computed field — a plain method; its return type IS the GraphQL type.
  displayName(): string {
    return (this.name ?? '').toUpperCase()
  }
}

export class Article extends models.Model {
  static objects = db.manager(Article)
  id = models.ID()
  title = models.Text()
  authorId = models.ForeignKey(() => Author)
  declare author: Relation<Author>
}

export class Activity extends models.Model {
  static objects = db.manager(Activity)
  id = models.ID()
  action = models.Text()
  target = models.Text()
}

// The blog app: registers its models, names them (→ blog_author/blog_article/blog_activity),
// and forms the 'blog' migration group. Not served itself — the host composes the schema.
// Zero-config migrations: they default to <app-source-dir>/migrations (here
// src/apps/blog/migrations), so no `migrations` option is needed.
export const blog = new Pylon({name: 'blog', db: {models: [Author, Article, Activity]}})
