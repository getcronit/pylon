import {describe, it, expect} from 'vitest'
import {buildTestSchema} from './test-utils'

describe('Pylon Builder - Inheritance & Interfaces', () => {
  it('should handle class inheritance with I-prefix and concrete types', () => {
    const code = `
      class User {
        username: string
        constructor(username: string) { this.username = username }
      }

      class HumanUser extends User {
        firstName: string
        lastName: string
      }

      const users: User[] = [new HumanUser()]

      export const graphql = {
        Query: {
          users
        }
      }
    `
    const result = buildTestSchema(code)

    expect(result.typeDefs).toContain('interface IUser')
    expect(result.typeDefs).toContain('type User implements IUser')
    expect(result.typeDefs).toContain('type HumanUser implements IUser')
    expect(result.resolvers.IUser.__resolveType).toContain('HumanUser')
    expect(result.resolvers.IUser.__resolveType).toContain('User')

    expect(result).toMatchSnapshot()
  })

  it('should handle interface implementation with I-prefix and concrete types', () => {
    const code = `
      interface User {
        username: string
      }

      class HumanUser implements User {
        username: string
        firstName: string
        lastName: string
      }

      const user: User = { username: 'guest' }

      export const graphql = {
        Query: {
          users: [new HumanUser()],
          current: user
        }
      }
    `
    const result = buildTestSchema(code)

    expect(result.typeDefs).toContain('interface IUser')
    expect(result.typeDefs).toContain('type User implements IUser')
    expect(result.typeDefs).toContain('type HumanUser implements IUser')

    expect(result).toMatchSnapshot()
  })

  it('should support multi-level inheritance', () => {
    const code = `
      class User { username: string }
      class MachineUser extends User { key: string }
      class MotorUser extends MachineUser { motorType: string }

      export const graphql = {
        Query: {
          motors: [new MotorUser()]
        }
      }
    `
    const result = buildTestSchema(code)

    expect(result.typeDefs).toContain(
      'type MotorUser implements IMachineUser & IUser'
    )
    expect(result.typeDefs).toContain('interface IMachineUser implements IUser')

    expect(result).toMatchSnapshot()
  })

  it('should handle transitive implementation for interfaces', () => {
    const code = `
      interface User { username: string }
      interface MachineUser extends User { key: string }
      class MotorUser implements MachineUser {
        username: string
        key: string
        motorType: string
      }

      export const graphql = {
        Query: {
          motors: [new MotorUser()]
        }
      }
    `
    const result = buildTestSchema(code)

    expect(result.typeDefs).toContain(
      'type MotorUser implements IMachineUser & IUser'
    )
    expect(result.typeDefs).toContain('interface IMachineUser implements IUser')

    expect(result).toMatchSnapshot()
  })
})
