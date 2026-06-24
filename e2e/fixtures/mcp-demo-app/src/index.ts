// A small but realistic blog — the bed for the MCP proof loop.
// Models (→ schema + persistence + authz), a queue (→ queues slice), and
// operations (→ Query/Mutation) assembled into one app the agent introspects.
import {Pylon} from '@getcronit/pylon'
import {models, db, type ModelConfig} from '@getcronit/pylon-db'
import {Queue, enqueuer} from '@getcronit/pylon-queues'

@models.model()
export class Author extends models.Model {
  static objects = db.manager(Author)
  id = models.ID()
  name = models.Text()
  posts = models.HasMany(() => Post, {foreignKey: 'authorId'})
}

@models.model()
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

@models.model()
export class Comment extends models.Model {
  static objects = db.manager(Comment)
  id = models.ID()
  body = models.Text()
  postId = models.ForeignKey(() => Post)
  authorId = models.ForeignKey(() => Author)
}

const app = new Pylon({
  name: 'blog',
  graphql: {
    Query: {
      posts: (): Promise<Post[]> => Post.objects.all(),
      comments: (): Promise<Comment[]> => Comment.objects.all()
    },
    Mutation: {
      createPost: (title: string, body: string, authorId: number): Promise<Post> =>
        Post.objects.create({title, body, authorId})
    }
  }
})

@app.queue({attempts: 3})
class NotifyFollowers extends Queue<{postId: string}> {
  static jobs = enqueuer(NotifyFollowers)
  async process() {}
}

export default app
