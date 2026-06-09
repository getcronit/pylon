/**
 * Stage 2a of the IR-first flip: `SchemaBuilder.build({contributeIR})` merges an
 * authoritative IR contribution (e.g. the ORM's entities) OVER what the
 * type-checker introspects, and renders the schema from the merged IR. This is
 * the mechanism that lets entity types reflect the ORM's intent (precise
 * scalars, hidden columns) instead of being re-derived from resolver types —
 * the seam that ultimately retires the isList/$-regex coupling.
 */
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {emptyIR, type PylonIR} from '@getcronit/pylon-ir'
import {describe, expect, it} from 'vitest'
import {SchemaBuilder} from '../src/builder/schema/builder'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.resolve(dir, 'fixtures/merge-app/index.ts')

const col = (name: string, sqlType: any, over: Record<string, unknown> = {}) => ({
  name,
  sqlType,
  primaryKey: false,
  autoIncrement: false,
  unique: false,
  nullable: false,
  ...over
})

// An authoritative ORM-style contribution for `User`: id is an ID (not the
// Number the type-checker would infer from `number`), and `secret` is hidden.
const contributeIR: PylonIR = {
  ...emptyIR(),
  entities: {
    User: {
      name: 'User',
      table: 'user',
      abstract: false,
      primaryKey: 'id',
      implements: [],
      fields: [
        {name: 'id', type: {kind: 'scalar', name: 'ID', nullable: false}, exposed: true, column: col('id', 'bigint', {primaryKey: true, autoIncrement: true})},
        {name: 'email', type: {kind: 'scalar', name: 'String', nullable: false}, exposed: true, column: col('email', 'text', {unique: true})},
        {name: 'secret', type: {kind: 'scalar', name: 'String', nullable: true}, exposed: false, column: col('secret', 'text', {nullable: true})}
      ]
    }
  }
}

describe('SchemaBuilder authoritative IR merge (Stage 2a)', () => {
  it('default build introspects User from the resolver type (number → Number, secret exposed)', () => {
    const {typeDefs} = new SchemaBuilder(fixture).build()
    expect(typeDefs).toMatch(/type User/)
    expect(typeDefs).toMatch(/id: Number!/)
    expect(typeDefs).toMatch(/secret: String!/)
  })

  it('contribution overrides the introspected type with ORM intent', () => {
    const {typeDefs} = new SchemaBuilder(fixture).build({contributeIR})
    // ORM intent wins: id is ID, secret is hidden.
    expect(typeDefs).toMatch(/id: ID!/)
    expect(typeDefs).not.toMatch(/secret/)
    expect(typeDefs).toMatch(/email: String!/)
    // exactly one User type — the entity replaced the introspected object.
    expect((typeDefs.match(/type User\b/g) ?? []).length).toBe(1)
  })

  it('still exposes the Query operation returning User', () => {
    const {typeDefs} = new SchemaBuilder(fixture).build({contributeIR})
    expect(typeDefs).toMatch(/type Query/)
    expect(typeDefs).toMatch(/user: User!/)
  })
})
