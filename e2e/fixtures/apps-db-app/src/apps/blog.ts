import {Pylon} from '@getcronit/pylon'
import {db, models} from '@getcronit/pylon-db'

const blog_ = models.app('blog')

@blog_.model() // → blog_post
export class Post extends blog_.Model {
  static objects = db.manager(Post)
  id = blog_.ID()
  title = blog_.Text()
  body = blog_.Text()
}

export const blog = new Pylon({
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
