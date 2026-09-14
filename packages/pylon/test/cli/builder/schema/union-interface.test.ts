import {expect, test} from 'vitest'

import {buildTestSchema} from './test-utils'

/**
 * A union's interface is the fields its members share.
 *
 * "Share" means the same field, not the same prose about it. These cover the
 * line between the two: type identity decides, documentation does not.
 */

test('a field documented on only one member still reaches the interface', () => {
  // The regression. The comparison serialised the whole field descriptor, and
  // a field's JSDoc lives inside it — so documenting `description` on one
  // member and not the other dropped it off the interface with no error, and
  // the only way to get it back was to write the same comment twice.
  const code = `
    interface ContentPage {
      __typename: 'ContentPage'
      slug: string
      /** Meta description. Null falls back to the layout's. */
      description: string | null
    }
    interface BlogPage {
      __typename: 'BlogPage'
      slug: string
      description: string | null
    }
    type Page = ContentPage | BlogPage
    class Query {
      page(): Page {
        return {__typename: 'ContentPage', slug: '', description: null}
      }
    }
    export const graphql = {Query}
  `

  const {typeDefs} = buildTestSchema(code)

  const iface = /interface Page \{[\s\S]*?\n\}/.exec(typeDefs)?.[0] ?? ''
  expect(iface).toContain('slug')
  expect(iface).toContain('description')
})

test('the interface takes a description from whichever member has one', () => {
  // The documented member is listed SECOND, so taking the first member's
  // description would leave the interface field undocumented.
  const code = `
    interface A {
      __typename: 'A'
      slug: string
      title: string
    }
    interface B {
      __typename: 'B'
      slug: string
      /** What the thing is called. */
      title: string
    }
    type Thing = A | B
    class Query {
      thing(): Thing {
        return {__typename: 'A', slug: '', title: ''}
      }
    }
    export const graphql = {Query}
  `

  const {typeDefs} = buildTestSchema(code)

  // Scoped to the INTERFACE. Against the whole SDL this passes for the wrong
  // reason — `type B` documents its own `title` either way.
  const iface = /interface Thing \{[\s\S]*?\n\}/.exec(typeDefs)?.[0] ?? ''
  expect(iface).toContain('title')
  expect(iface).toContain('What the thing is called.')
})

test('a field whose nullability differs stays off the interface', () => {
  // Type identity is still strict. An interface declaring `String!` that a
  // member satisfies with `String` is an invalid schema, not a friendlier one.
  const code = `
    interface A {
      __typename: 'A'
      slug: string
      note: string
    }
    interface B {
      __typename: 'B'
      slug: string
      note: string | null
    }
    type Thing = A | B
    class Query {
      thing(): Thing {
        return {__typename: 'A', slug: '', note: ''}
      }
    }
    export const graphql = {Query}
  `

  const {typeDefs} = buildTestSchema(code)

  const iface = /interface Thing \{[^}]*\}/.exec(typeDefs)?.[0] ?? ''
  expect(iface).toContain('slug')
  expect(iface).not.toContain('note')
})
