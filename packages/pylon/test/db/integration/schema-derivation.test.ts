/**
 * REAL cross-package integration: drive Pylon's actual `SchemaBuilder` over a
 * real Pylon entrypoint (`fixtures/schema-app.ts`) built on real
 * `@getcronit/pylon-db` models, and assert on the GraphQL SDL it emits.
 *
 * Unlike a unit test that mirrors Pylon's type predicates, this compiles the
 * ORM's actual source types through Pylon's actual introspection pipeline — so
 * it proves the end-to-end contract: scalars map to primitives, `hasMany`
 * derives a list, `belongsTo` derives a nullable single type, and `$`-prefixed
 * machinery (hidden columns + `$save`/`$delete`) never reaches the schema.
 */
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it, beforeAll} from 'vitest'
// Import Pylon's real schema builder from source (no public export exists).
import {SchemaBuilder} from '../../../pylon-dev/src/builder/schema/builder'
// Execute the fixture's models so the ORM registry is populated, then we can
// build with the real ORM IR contribution (`pylon build`'s actual path).
import './fixtures/schema-app'
import {toIR} from '../../src/index'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.resolve(dir, 'fixtures/schema-app.ts')

let typeDefs: string
let resolvers: Record<string, unknown>

beforeAll(() => {
  const built = new SchemaBuilder(fixture).build()
  typeDefs = built.typeDefs
  resolvers = built.resolvers
})

describe('ORM ↔ GraphQL schema derivation (real SchemaBuilder)', () => {
  it('emits a User type from the resolver return', () => {
    expect(typeDefs).toMatch(/type User\b/)
  })

  it('maps scalar columns to GraphQL primitives', () => {
    expect(typeDefs).toMatch(/email:\s*String/)
    expect(typeDefs).toMatch(/isActive:\s*Boolean/)
    expect(typeDefs).toMatch(/createdAt:\s*(DateTime|Date|String)/)
  })

  it('derives a hasMany relation as a LIST of the target type', () => {
    expect(typeDefs).toMatch(/posts:\s*\[Post[!]?\]/)
  })

  it('derives a belongsTo relation as a single target type', () => {
    expect(typeDefs).toMatch(/type Post\b/)
    expect(typeDefs).toMatch(/author:\s*User/)
  })

  it('derives a manyToMany relation as a LIST of the target type', () => {
    expect(typeDefs).toMatch(/type Tag\b/)
    expect(typeDefs).toMatch(/tags:\s*\[Tag[!]?\]/)
  })


  it('[#43] derives a nullable ref resolver (T | null) as a NULLABLE field', () => {
    // `maybeUser(): Promise<User | null>` must be `maybeUser: User` (no `!`).
    expect(typeDefs).toMatch(/maybeUser:\s*User(?!!)/)
  })

  it('[#43] derives a nullable ref INSIDE a payload object as nullable', () => {
    // UpdateUserPayload.user is `User | null` → `user: User` (no `!`).
    const block = typeDefs.match(/type UpdateUserPayload\b[^}]*}/)?.[0] ?? ''
    expect(block).toMatch(/user:\s*User(?!!)/)
  })

  it('[#43] mapped-type wrapper ({[K]: T[K] | null}) makes the ref nullable', () => {
    // This is the mutation()-wrapper shape. The payload type's `user` field must
    // be nullable (`User`, no `!`).
    const block =
      typeDefs.match(/type SaveUser[A-Za-z]*\b[^}]*}/)?.[0] ??
      typeDefs.match(/type [A-Za-z]*Payload\b[^}]*}/g)?.join('\n') ??
      ''
    // Find whichever generated type carries the `user` + `userErrors` fields.
    const payloadBlocks = typeDefs.match(/type \w+\s*{[^}]*userErrors[^}]*}/g) ?? []
    const target = payloadBlocks.find(b => /user:/.test(b)) ?? block
    expect(target).toMatch(/user:\s*User(?!!)/)
  })

  it('excludes $-prefixed hidden columns from the schema', () => {
    expect(typeDefs).not.toMatch(/passwordHash/i)
  })

  it('does NOT leak Active Record $save/$delete as fields', () => {
    expect(typeDefs).not.toMatch(/\bsave\b/)
    expect(typeDefs).not.toMatch(/\bdelete\b/)
  })

  it('does NOT leak ORM-internal docs as GraphQL descriptions', () => {
    expect(typeDefs).not.toMatch(/RelatedManager/)
    expect(typeDefs).not.toMatch(/chainable/)
  })

  it('every resolver key exists in the typeDefs (executable-schema invariant)', () => {
    // makeExecutableSchema({typeDefs, resolvers}) throws if a resolver names a
    // type absent from the SDL — e.g. an empty `IModel` interface dropped from
    // the SDL but still emitted as a resolver. Guards that runtime build.
    for (const key of Object.keys(resolvers)) {
      expect(
        typeDefs,
        `resolver "${key}" must be a declared type in the SDL`
      ).toMatch(new RegExp(`\\b(type|interface|union|enum|input|scalar) ${key}\\b`))
    }
  })
})

// The REAL `pylon build` path: parser IR merged with the ORM's `contributeIR`
// (this is where enum columns + nullable refs resolve, and orphan enums prune).
describe('merged schema (parser IR + ORM contributeIR)', () => {
  let sdl: string
  beforeAll(() => {
    sdl = new SchemaBuilder(fixture).build({contributeIR: toIR()}).typeDefs
  })

  it('derives an enumColumn as a GraphQL enum named <Model><Field>, not String', () => {
    expect(sdl).toMatch(/role:\s*UserRole/)
    expect(sdl).toMatch(/enum UserRole\b/)
    expect(sdl).not.toMatch(/role:\s*String/)
  })

  it('prunes the type-checker orphan enum left after the field reconciles', () => {
    expect(sdl).not.toMatch(/enum Role\b/)
    expect(sdl).not.toMatch(/enum ADMIN_USER\b/)
  })

  it('keeps the ORM intent for scalar/relation fields (id: ID, m2m list)', () => {
    expect(sdl).toMatch(/id:\s*ID!/)
    expect(sdl).toMatch(/tags:\s*\[Tag[!]?\]/)
  })
})
