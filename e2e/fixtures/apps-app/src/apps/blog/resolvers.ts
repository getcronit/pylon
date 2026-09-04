// blog app — GraphQL resolvers (plain Query/Mutation, exactly the host shape).
import {Activity, Article, Author} from './index.js'

export const Query = {
  author: (id: number): Promise<Author> => Author.objects.get({id}),
  authors: (): Promise<Author[]> => Author.objects.all(),
  activities: (): Promise<Activity[]> => Activity.objects.all()
}

export const Mutation = {
  createAuthor: (name: string): Promise<Author> => Author.objects.create({name}),
  addArticle: (authorId: number, title: string): Promise<Article> =>
    Article.objects.create({authorId, title})
}
