import {describe, expect, it} from 'vitest'
import {
  Model,
  enumField,
  getModelDefinitionOrThrow,
  id,
  int,
  model,
  text,
  validateInstance,
  ValidationError
} from '../src/index'

@model()
class Account extends Model {
  id = id()
  email = text({email: true, max: 50})
  age = int({min: 0, max: 130})
  role = enumField(['admin', 'user'] as const)
  username = text({min: 3, pattern: /^[a-z0-9_]+$/})
  bio = text({nullable: true})
  slug = text({validate: v => /^[a-z-]+$/.test(v as string) || 'must be kebab-case'})
}
const def = getModelDefinitionOrThrow(Account)

describe('validateInstance — structured issues (code + params)', () => {
  it('reports the right code/params per failing rule', () => {
    const issues = validateInstance(def, {
      email: 'nope',
      age: 200,
      role: 'root',
      username: 'a',
      slug: 'Not A Slug'
    })
    const by = Object.fromEntries(issues.map(i => [i.path, i]))
    expect(by.email.code).toBe('email')
    expect(by.age.code).toBe('max')
    expect(by.age.params).toEqual({max: 130})
    expect(by.role.code).toBe('enum')
    expect(by.role.params).toEqual({values: ['admin', 'user']})
    expect(by.username.code).toBe('length')
    expect(by.username.params).toEqual({min: 3})
    expect(by.slug).toMatchObject({code: 'custom', message: 'must be kebab-case'})
  })

  it('a valid instance has no issues', () => {
    expect(
      validateInstance(def, {
        email: 'a@b.co',
        age: 30,
        role: 'admin',
        username: 'alice',
        slug: 'ok-slug'
      })
    ).toEqual([])
  })

  it('required: a non-nullable, non-default field that is absent', () => {
    const issues = validateInstance(def, {age: 30, role: 'admin', username: 'alice', slug: 'x'})
    expect(issues.find(i => i.path === 'email')?.code).toBe('required')
  })

  it('a nullable field may be absent; an autoIncrement PK is never required', () => {
    const issues = validateInstance(def, {
      email: 'a@b.co',
      age: 1,
      role: 'user',
      username: 'bob',
      slug: 'x'
    })
    expect(issues.find(i => i.path === 'bio')).toBeUndefined()
    expect(issues.find(i => i.path === 'id')).toBeUndefined()
  })

  it('ValidationError carries the issues + a readable message', () => {
    const err = new ValidationError([{path: 'age', code: 'max', message: 'too big', params: {max: 1}}])
    expect(err.issues).toHaveLength(1)
    expect(err.message).toMatch(/age: too big/)
  })
})
