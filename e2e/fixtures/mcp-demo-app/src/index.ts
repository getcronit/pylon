// A small but realistic blog — the bed for the MCP proof loop.
// Models (→ schema + persistence + authz), a queue (→ queues slice), and
// operations (→ Query/Mutation) assembled into one app the agent introspects.
import {Pylon} from '@getcronit/pylon'
import {models, db, type ModelConfig} from '@getcronit/pylon-db'
import {Queue, manager, type QueueConfig} from '@getcronit/pylon-queues'

export class Author extends models.Model {
  static objects = db.manager(Author)
  id = models.ID()
  name = models.Text()
  posts = models.HasMany(() => Post, {foreignKey: 'authorId'})
}

export class Post extends models.Model {
  static objects = db.manager(Post)
  static config = {secure: true, indexes: [{columns: ['authorId']}]} satisfies ModelConfig<Post>
  id = models.ID()
  title = models.Text()
  body = models.Text()
  published = models.Boolean({default: false})
  authorId = models.ForeignKey(() => Author)

  // Co-located resource policy: public posts are readable; authors manage their own.
  static abilities(p: {id?: string} | undefined, can: any) {
    can('read', {OR: [{published: true}, {authorId: p?.id}]})
    can('update', {authorId: p?.id})
  }
}

export class Comment extends models.Model {
  static objects = db.manager(Comment)
  id = models.ID()
  body = models.Text()
  postId = models.ForeignKey(() => Post)
  authorId = models.ForeignKey(() => Author)
}

class NotifyFollowers extends Queue<{postId: string}> {
  static config = {attempts: 3} satisfies QueueConfig<NotifyFollowers>
  static jobs = manager(NotifyFollowers)
  async process() {}
}

// A single (un-named) app owns everything: nameless ⇒ bare table names
// (author/post/comment, no prefix), and the models/queues live on the app instance
// the tooling reads (modelsOf/queuesOf), not a sibling registration.
export default new Pylon({
  db: {models: [Author, Post, Comment]},
  graphql: {
    Query: {
      posts: (): Promise<Post[]> => Post.objects.all(),
      comments: (): Promise<Comment[]> => Comment.objects.all()
    },
    Mutation: {
      createPost: (title: string, body: string, authorId: number): Promise<Post> =>
        Post.objects.create({title, body, authorId})
    }
  },
  queues: [NotifyFollowers]
})
