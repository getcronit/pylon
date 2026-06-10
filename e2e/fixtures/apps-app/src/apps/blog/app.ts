// blog app — manifest: models + GraphQL fragment + a Hono route, composed by the
// host via createApp().
import {defineApp} from '@getcronit/pylon'
import {Article, Author} from './models.js'

export const blog = defineApp({
  name: 'blog',
  models: [Author, Article],
  graphql: {
    Query: {
      author: (id: number): Promise<Author> => Author.objects.get({id}),
      authors: (): Promise<Author[]> => Author.objects.all()
    },
    Mutation: {
      createAuthor: (name: string): Promise<Author> => Author.objects.create({name}),
      addArticle: (authorId: number, title: string): Promise<Article> =>
        Article.objects.create({authorId, title})
    }
  },
  // Hono contribution — a plain REST endpoint mounted on the app.
  routes(app) {
    app.get('/blog/ping', c => c.text('blog-pong'))
  }
})
