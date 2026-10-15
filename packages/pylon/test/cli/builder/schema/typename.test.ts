import {buildTestSchema} from './test-utils'
import {expect, test} from 'vitest'

test('uses __typename literal for type name', () => {
  const code = `
    class Query {
      getUser(): { __typename: 'CustomUser'; id: number; name: string } {
        return {__typename: 'CustomUser', id: 1, name: 'John'}
      }
    }
    export const graphql = {Query}
  `

  const {typeDefs} = buildTestSchema(code)

  expect(typeDefs).toContain('type CustomUser')
  expect(typeDefs).toContain('getUser: CustomUser')
})

test('ignores non-literal __typename', () => {
  const code = `
    class Query {
      getUser(): { __typename: string; id: number; name: string } {
        return {__typename: 'CustomUser', id: 1, name: 'John'}
      }
    }
    export const graphql = {Query}
  `

  const {typeDefs} = buildTestSchema(code)

  // It should NOT be CustomUser, probably GetUser or similar inferred name
  expect(typeDefs).not.toContain('type CustomUser')
})
