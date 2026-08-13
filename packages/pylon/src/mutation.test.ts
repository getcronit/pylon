import {describe, expect, it} from 'vitest'
import {ServiceError} from './core/define-pylon'
import {mutation} from './core/mutation'

describe('mutation() — Shopify-style userErrors', () => {
  it('on success: returns the payload + an empty userErrors array', async () => {
    const create = mutation(async (name: string) => ({user: {id: 1, name}}))
    const res = await create('Ada')
    expect(res).toEqual({user: {id: 1, name: 'Ada'}, userErrors: []})
  })

  it('maps a structural ValidationError (issues) to userErrors, entity omitted', async () => {
    const failing = mutation(async () => {
      throw {issues: [{path: 'email', code: 'invalid_email', message: 'Bad email'}]}
    })
    const res = await failing()
    expect(res).toEqual({
      userErrors: [{field: ['email'], message: 'Bad email', code: 'invalid_email'}]
    })
    expect((res as any).user).toBeUndefined()
  })

  it('splits a dotted issue path into a field array', async () => {
    const failing = mutation(async () => {
      throw {issues: [{path: 'address.zip', message: 'Required'}]}
    })
    const res = await failing()
    expect(res.userErrors[0].field).toEqual(['address', 'zip'])
  })

  it('maps a ServiceError (business rule) to a userError with its code + field', async () => {
    const failing = mutation(async () => {
      throw new ServiceError('SKU in use', {
        code: 'SKU_TAKEN',
        statusCode: 409,
        details: {field: ['sku']}
      })
    })
    const res = await failing()
    expect(res.userErrors).toEqual([
      {field: ['sku'], message: 'SKU in use', code: 'SKU_TAKEN'}
    ])
  })

  it('rethrows unexpected errors (masked / Sentry), not surfaced as userErrors', async () => {
    const boom = mutation(async () => {
      throw new Error('database is on fire')
    })
    await expect(boom()).rejects.toThrow(/database is on fire/)
  })
})
