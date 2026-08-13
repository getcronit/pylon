import {emptyIR, mergeIR, toSDL, type PylonIR} from '@getcronit/pylon-ir'
import {describe, expect, it} from 'vitest'
import {buildParser, buildTestSchema} from './test-utils'

// Simulate the ORM contributing `Author` as a persisted entity.
const authorEntity: PylonIR = {
  ...emptyIR(),
  entities: {
    Author: {
      name: 'Author',
      table: 'author',
      abstract: false,
      primaryKey: 'id',
      implements: [],
      fields: [
        {
          name: 'id',
          type: {kind: 'scalar', name: 'ID', nullable: false},
          exposed: true,
          column: {name: 'id', sqlType: 'bigint', primaryKey: true, autoIncrement: true, unique: false, nullable: false}
        },
        {
          name: 'name',
          type: {kind: 'scalar', name: 'String', nullable: false},
          exposed: true,
          column: {name: 'name', sqlType: 'text', primaryKey: false, autoIncrement: false, unique: false, nullable: false}
        }
      ]
    }
  }
}

// #43 — nullable object/entity references. These PROVE the parser + IR + mergeIR
// pipeline honors `T | null` for object/entity refs in every reproducible shape:
// direct return, nested payload field, through the ORM mergeIR contribution, and
// via the exact `mutation()` mapped-type generic with an inferred `R`. (The real
// multi-file build with a *decorated ORM-model* type still mis-renders one case;
// that is NOT reproducible here, so it's a separate full-build-only investigation.)
describe('nullable object/entity references (parser/IR/merge pipeline)', () => {
  it('a Query field returning `T | null` is nullable; `T` stays non-null', () => {
    const {typeDefs} = buildTestSchema(`
      type Foo = { id: number }
      export const graphql = {
        Query: {
          maybeFoo: (): Foo | null => null,
          alwaysFoo: (): Foo => ({ id: 1 }),
        }
      }
    `)
    expect(typeDefs).toMatch(/maybeFoo: Foo(?!!)/) // nullable: "Foo" not "Foo!"
    expect(typeDefs).toMatch(/alwaysFoo: Foo!/)
  })

  it('a nullable object FIELD on a returned object is nullable', () => {
    const {typeDefs} = buildTestSchema(`
      type Foo = { id: number }
      export const graphql = {
        Query: {
          wrap: (): { foo: Foo | null; ok: string } => ({ foo: null, ok: "x" }),
        }
      }
    `)
    expect(typeDefs).toMatch(/foo: Foo(?!!)/) // nullable
    expect(typeDefs).toMatch(/ok: String!/)
  })

  it('a nullable ENTITY ref stays nullable through the ORM mergeIR path', () => {
    // This is the real-build path: parser IR merged with an ORM entity contribution.
    const base = buildParser(`
      class Author { id: number = 1; name: string = '' }
      export const graphql = {
        Query: {
          maybeAuthor: (): Author | null => null,
          alwaysAuthor: (): Author => ({ id: 1, name: 'a' }) as any,
        }
      }
    `).toIR()
    const sdl = toSDL(mergeIR(base, authorEntity))
    expect(sdl).toMatch(/maybeAuthor: Author(?!!)/) // nullable
    expect(sdl).toMatch(/alwaysAuthor: Author!/)
  })

  it('a nullable ENTITY ref as a NESTED payload field, via mergeIR (the real case)', () => {
    const base = buildParser(`
      class Author { id: number = 1; name: string = '' }
      export const graphql = {
        Query: {
          wrap: (): { author: Author | null; ok: string } => ({ author: null, ok: 'x' }),
        }
      }
    `).toIR()
    const sdl = toSDL(mergeIR(base, authorEntity))
    expect(sdl).toMatch(/author: Author(?!!)/) // nullable
    expect(sdl).toMatch(/ok: String!/)
  })

  it('a MAPPED-TYPE payload (`{[K]: T[K] | null}`) keeps entity refs nullable', () => {
    // This mirrors the mutation() wrapper's return type exactly.
    const base = buildParser(`
      type Payload<R> = {[K in keyof R]: R[K] | null} & {userErrors: {message: string}[]}
      class Author { id: number = 1; name: string = '' }
      export const graphql = {
        Query: {
          wrap: (): Payload<{author: Author}> => ({ author: null, userErrors: [] }),
        }
      }
    `).toIR()
    const sdl = toSDL(mergeIR(base, authorEntity))
    expect(sdl).toMatch(/author: Author(?!!)/) // nullable
  })

  it('the EXACT mutation() generic (inferred R + Awaited + mapped type)', () => {
    const base = buildParser(`
      type UserError = { field: string[]; message: string; code: string }
      function mutation<A extends any[], R>(
        fn: (...a: A) => R | Promise<R>
      ): (...a: A) => Promise<{[K in keyof Awaited<R>]: Awaited<R>[K] | null} & {userErrors: UserError[]}> {
        return null as any
      }
      class Author { id: number = 1; name: string = '' }
      export const graphql = {
        Mutation: {
          createAuthorSafe: mutation(async (name: string) => {
            const author = new Author()
            return {author}
          })
        }
      }
    `).toIR()
    const sdl = toSDL(mergeIR(base, authorEntity))
    expect(sdl).toMatch(/author: Author(?!!)/) // nullable
  })

  it('a nullable scalar field stays nullable (regression guard)', () => {
    const {typeDefs} = buildTestSchema(`
      export const graphql = {
        Query: {
          wrap: (): { name: string | null } => ({ name: null }),
        }
      }
    `)
    expect(typeDefs).toMatch(/name: String(?!!)/)
  })
})
