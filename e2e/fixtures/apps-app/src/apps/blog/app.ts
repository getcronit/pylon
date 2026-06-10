// blog app — manifest: models + a resolver fragment the host composes.
import {apps} from '@getcronit/pylon-db'
import {Article, Author} from './models.js'

export const blog = apps.defineApp({
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
  }
})
