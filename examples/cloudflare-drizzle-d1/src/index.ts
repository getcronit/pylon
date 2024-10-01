import {app, getContext} from '@getcronit/pylon'
import {drizzle} from 'drizzle-orm/d1'
import * as crypto from 'crypto'

import * as schema from './schema'

const getDb = () => {
  const ctx = getContext()

  const d1 = (ctx.env as any).DB as D1Database

  return drizzle(d1, {schema})
}

export const graphql = {
  Query: {
    /**
     * Get all users from the database
     */
    async users() {
      const db = getDb()

      const users = await db.query.user.findMany()

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
