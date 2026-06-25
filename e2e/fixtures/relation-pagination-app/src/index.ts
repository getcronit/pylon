// Paginated relations: a hasMany and a manyToMany declared with {paginate: true}
// surface as Relay Connection fields (first/after/last/before args) instead of
// plain lists; a non-paginated hasMany stays a list (control). The runtime serves
// real cursor pages over each relation.
import {Pylon} from '@getcronit/pylon'
import {db, models, type Relation} from '@getcronit/pylon-db'

export class Author extends models.Model {
  static objects = db.manager(Author)
  id = models.ID()
  name = models.Text()
  // paginated reverse one-to-many → posts(first, after, last, before): PostConnection
  posts = models.HasMany(() => Post, {foreignKey: 'authorId', paginate: true})
  // control: a plain list
  drafts = models.HasMany(() => Post, {foreignKey: 'authorId'})
}

export class Post extends models.Model {
  static objects = db.manager(Post)
  id = models.ID()
  title = models.Text()
  authorId = models.ForeignKey(() => Author)
  declare author: Relation<Author>
  // paginated many-to-many → tags(first, ...): TagConnection
  tags = models.ManyToMany(() => Tag, {paginate: true})
}

export class Tag extends models.Model {
  static objects = db.manager(Tag)
  id = models.ID()
  label = models.Text()
  posts = models.ManyToMany(() => Post)
}

export default new Pylon({
  db: {models: [Author, Post, Tag]},
  graphql: {
    Query: {
      author: (id: number): Promise<Author> => Author.objects.get({id})
    },
    Mutation: {
      addAuthor: (name: string): Promise<Author> => Author.objects.create({name}),
      addPost: (authorId: number, title: string): Promise<Post> =>
        Post.objects.create({authorId, title}),
      addTag: (label: string): Promise<Tag> => Tag.objects.create({label}),
      tagPost: async (postId: number, tagId: number): Promise<boolean> => {
        const post = await Post.objects.get({id: postId})
        await post.tags.add(tagId)
        return true
      }
    }
  }
})
