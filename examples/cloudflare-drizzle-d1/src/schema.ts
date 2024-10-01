import {integer, text, sqliteTable} from 'drizzle-orm/sqlite-core'

export enum Role {
  Admin = 'admin',
  Customer = 'customer'
}

export const user = sqliteTable('user', {
  id: integer('id').primaryKey({autoIncrement: true}),
  name: text('name'),
  email: text('email'),
  password: text('password'),
  roles: text('roles').default(JSON.stringify([])).notNull(),
  createdAt: text('created_at'), // Use text for timestamps
  updatedAt: text('updated_at') // Use text for timestamps
})
