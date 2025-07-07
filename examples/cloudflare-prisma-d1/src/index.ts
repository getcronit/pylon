import { app, getContext, getEnv, requireAuth } from "@getcronit/pylon";
import { UserNotFoundError } from "./errors/user.errors";
import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'

export const graphql = {
  Query: {
    /**
     * Get all users from the database
     */
    async users() {
      const env: any = getEnv();

      const adapter = new PrismaD1(env.DB)
      const prisma = new PrismaClient({ adapter })

      const users = await prisma.user.findMany()
      return users.map(user => ({
        ...user,
        roles: JSON.parse(user.roles)
      }))
    }
  },
  Mutation: {
    /**
     * Create a new user with the given data
     * The password will be hashed before storing it
     */
    async userCreate(data: {
      name: string
      email: string
      password: string
      roles: string[]
    }) {
      const db = getDb()

      data.password = crypto
        .createHash('sha256')
        .update(data.password)
        .digest('hex')

      const user = await db
        .insert(schema.user)
        .values({
          ...data,
          roles: JSON.stringify(data.roles),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .returning()

      return user
    }
  }
}

export default app
