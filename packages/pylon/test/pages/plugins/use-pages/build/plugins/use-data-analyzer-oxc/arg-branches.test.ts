import {describe, expect, it} from 'vitest'
import {canon, select} from './_harness'

/**
 * The same field fetched with DIFFERENT arguments can't share a selection — each
 * arg set becomes its own (aliased) branch, so the field's value is an array of
 * per-arg nodes. Identical args merge into one node.
 */
const eq = (got: any, exp: any) => expect(canon(got)).toEqual(canon(exp))

describe('oxc analyzer · arg-branch arrays', () => {
  it('branches a field read with two different argument sets', () => {
    eq(
      select(`const a = data.user({ id: "1" }); const b = data.user({ id: "2" })
        use(a.name); use(b.email)`),
      {
        user: [
          {__args: '{ id: "1" }', name: true},
          {__args: '{ id: "2" }', email: true}
        ]
      }
    )
  })

  it('merges reads that share identical arguments', () => {
    eq(
      select(`const a = data.user({ id: "1" }); const b = data.user({ id: "1" })
        use(a.name); use(b.email)`),
      {user: {__args: '{ id: "1" }', name: true, email: true}}
    )
  })

  it('keeps nested sub-selections per branch', () => {
    eq(
      select(`const a = data.user({ id: "1" }); const b = data.user({ id: "2" })
        use(a.profile.address.city); use(b.name)`),
      {
        user: [
          {__args: '{ id: "1" }', profile: {address: {city: true}}},
          {__args: '{ id: "2" }', name: true}
        ]
      }
    )
  })

  it('branches a value that unions two different-arg reads', () => {
    eq(
      select(`let u = data.user({ id: "1" })
        if (cond) { u = data.user({ id: "2" }) }
        use(u.email)`),
      {
        user: [
          {__args: '{ id: "1" }', email: true},
          {__args: '{ id: "2" }', email: true}
        ]
      }
    )
  })
})
