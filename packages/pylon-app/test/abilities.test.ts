import {describe, expect, it} from 'vitest'
import {runWithAppContext} from '@getcronit/pylon-db'
import {
  AbilityMatchError,
  authorize,
  can,
  cannot,
  defineAbilities,
  filter,
  ForbiddenError,
  matchWhere
} from '../src/index'

// A fake subject "model" — abilities key on class name.
class Invoice {
  id = 0
  ownerId = 0
  shared = false
  total = 0
}

const as = <T>(principal: any, fn: () => T): T =>
  runWithAppContext({principal, features: []}, fn)

describe('matchWhere (in-memory WhereInput matcher)', () => {
  it('matches scalar equality, operators, and logical combinators', () => {
    const row = {ownerId: 7, shared: false, total: 100, title: 'Hello'}
    expect(matchWhere(row, {ownerId: 7})).toBe(true)
    expect(matchWhere(row, {ownerId: 8})).toBe(false)
    expect(matchWhere(row, {total: {gte: 100}})).toBe(true)
    expect(matchWhere(row, {total: {gt: 100}})).toBe(false)
    expect(matchWhere(row, {ownerId: {in: [1, 7]}})).toBe(true)
    expect(matchWhere(row, {title: {contains: 'ell'}})).toBe(true)
    expect(matchWhere(row, {OR: [{ownerId: 1}, {shared: false}]})).toBe(true)
    expect(matchWhere(row, {OR: [{ownerId: 1}, {shared: true}]})).toBe(false)
    expect(matchWhere(row, {AND: [{ownerId: 7}, {total: {lt: 200}}]})).toBe(true)
    expect(matchWhere(row, {NOT: {ownerId: 1}})).toBe(true)
    expect(matchWhere(row, {OR: []})).toBe(false) // empty OR ⇒ nothing
  })

  it('rejects relation/nested conditions (deferred to query layer)', () => {
    expect(() => matchWhere({a: 1}, {author: {name: 'x'}} as any)).toThrow(AbilityMatchError)
  })
})

describe('defineAbilities → can / cannot / authorize', () => {
  defineAbilities((p, can, cannot) => {
    if (p?.roles?.includes('admin')) {
      can('manage', 'all')
      return
    }
    can('read', Invoice, {OR: [{ownerId: p?.id ?? -1}, {shared: true}]})
    can('update', Invoice, {ownerId: p?.id ?? -1})
    cannot('update', Invoice, {total: {gte: 1000}}) // nobody edits large invoices
  })

  const own = Object.assign(new Invoice(), {id: 1, ownerId: 7, shared: false, total: 50})
  const shared = Object.assign(new Invoice(), {id: 2, ownerId: 99, shared: true, total: 50})
  const huge = Object.assign(new Invoice(), {id: 3, ownerId: 7, shared: false, total: 5000})

  it('allows owner reads, shared reads; denies others', () => {
    as({id: 7}, () => {
      expect(can('read', own)).toBe(true)
      expect(can('read', shared)).toBe(true)
      expect(can('read', Object.assign(new Invoice(), {ownerId: 8, shared: false}))).toBe(false)
    })
  })

  it('cannot() denies updates to large invoices even for the owner', () => {
    as({id: 7}, () => {
      expect(can('update', own)).toBe(true)
      expect(cannot('update', huge)).toBe(true) // matching cannot wins
    })
  })

  it('manage/all wildcard grants admins everything', () => {
    as({id: 9, roles: ['admin']}, () => {
      expect(can('read', huge)).toBe(true)
      expect(can('delete', own)).toBe(true)
    })
  })

  it('authorize (resource form) throws ForbiddenError on denial', () => {
    as({id: 7}, () => {
      expect(() => authorize('read', own)).not.toThrow()
      expect(() => authorize('update', huge)).toThrow(ForbiddenError)
    })
  })

  it('authorize (capability form) still works via the overload', () => {
    as({id: 7, roles: ['admin']}, () => {
      expect(() => authorize(p => !!p?.roles?.includes('admin'))).not.toThrow()
      expect(() => authorize(p => !!p?.roles?.includes('nope'))).toThrow(ForbiddenError)
    })
  })
})

describe('filter (WhereInput projection for query scoping)', () => {
  it('projects allow conditions to OR, and cannot to AND NOT', () => {
    as({id: 7}, () => {
      const f = filter('update', Invoice)
      expect(f).toEqual({
        AND: [{OR: [{ownerId: 7}]}, {NOT: {total: {gte: 1000}}}]
      })
    })
  })

  it('returns true (allow-all) for manage/all and false (deny-all) when ungranted', () => {
    as({id: 9, roles: ['admin']}, () => expect(filter('read', Invoice)).toBe(true))
    as({id: 7}, () => expect(filter('delete', Invoice)).toBe(false)) // no delete rule
  })
})
