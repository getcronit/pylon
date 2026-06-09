// Fixture: a resolver returns a plain class `User`. The merge test feeds an
// authoritative ORM-style entity IR for `User` and asserts it overrides this.
class User {
  id!: number
  email!: string
  secret!: string
}

export const graphql = {
  Query: {
    user: (): User => ({}) as User
  }
}
