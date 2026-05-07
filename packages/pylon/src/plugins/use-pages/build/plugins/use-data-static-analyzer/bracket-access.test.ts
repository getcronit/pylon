import {describe, expect, it} from 'vitest'
import {extractAdvancedSelectors} from './analyze'

describe('Bracket Access Analysis', () => {
  it('should treat string bracket access as property access, not list', () => {
    const input = `
      const data = {user: {email: 'email'}}
      const user = data.user;
      const email = user["email"];
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        email: true
      }
    })
  })

  it('should treat number bracket access as list access', () => {
    const input = `
      const data = {users: [{name: 'name'}]}
      const users = data.users;
      const first = users[0];
      console.log(first.name);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __isList: true,
        name: true
      }
    })
  })
})
