import {describe, expect, it} from 'vitest'
import {select} from './_harness'

describe('oxc analyzer · field reads', () => {
  it('reads a scalar off a root object field', () => {
    expect(select('const e = data.me.email')).toEqual({me: {email: true}})
  })

  it('reads a field with arguments, keeping the arg source', () => {
    expect(select('const u = data.user({ id: "1" }); const e = u.email')).toEqual({
      user: {__args: '{ id: "1" }', email: true}
    })
  })

  it('follows nested object fields', () => {
    expect(select('const c = data.me.profile.address.city')).toEqual({
      me: {profile: {address: {city: true}}}
    })
  })

  it('supports deep object destructuring', () => {
    expect(
      select('const { profile: { address: { city } } } = data.me; use(city)')
    ).toEqual({me: {profile: {address: {city: true}}}})
  })

  it('reads an enum field as a scalar leaf', () => {
    expect(select('const r = data.me.role')).toEqual({me: {role: true}})
  })

  it('follows optional chaining and nullish coalescing', () => {
    expect(
      select('const c = data.user({ id: "1" })?.profile?.address?.city ?? "?"')
    ).toEqual({user: {__args: '{ id: "1" }', profile: {address: {city: true}}}})
  })

  it('unions both branches of a ternary', () => {
    expect(
      select('const u = cond ? data.me : data.user({ id: "1" }); use(u.name)')
    ).toEqual({me: {name: true}, user: {__args: '{ id: "1" }', name: true}})
  })

  it('unions reassignment across if/else branches', () => {
    expect(
      select(`let u = data.me
        if (cond) { u = data.user({ id: "1" }) }
        use(u.email)`)
    ).toEqual({me: {email: true}, user: {__args: '{ id: "1" }', email: true}})
  })

  it('drops JS intrinsics that are not schema fields', () => {
    // .toString()/.length are not fields on User → dropped by schema validation.
    expect(select('const s = data.me.name.toString(); use(s)')).toEqual({
      me: {name: true}
    })
  })

  it('follows a value returned from a local helper (closure over the seed)', () => {
    expect(
      select(`function getMe() { return data.me }
        const m = getMe(); use(m.email)`)
    ).toEqual({me: {email: true}})
  })
})
