import {Pylon} from '@getcronit/pylon'
import {db, models} from '@getcronit/pylon-db'

// Decorator-free: a plain model class, registered + named via the app constructor.
export class Post extends models.Model {
  static objects = db.manager(Post)
  id = models.ID()
  title = models.Text()
  body = models.Text()
}

export const blog = new Pylon({
  name: 'blog', // → table blog_post + its own migration group
  db: {models: [Post]},
  graphql: {
    Query: {
      post: (id: number): Promise<Post> => Post.objects.get({id}),
      posts: (): Promise<Post[]> => Post.objects.all()
    },
    Mutation: {
      addPost: (title: string, body: string): Promise<Post> =>
        Post.objects.create({title, body})
    }
  }
})
