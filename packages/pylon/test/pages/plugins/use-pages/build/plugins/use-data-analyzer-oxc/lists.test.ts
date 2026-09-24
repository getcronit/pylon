import {describe, expect, it} from 'vitest'
import {select} from './_harness'

describe('oxc analyzer · lists & iteration (list-ness from the schema)', () => {
  it('marks an object-list field and follows element reads via .map', () => {
    expect(select('data.users.map(u => u.name)')).toEqual({
      users: {__isList: true, name: true}
    })
  })

  it('does NOT mark a singular object field as a list', () => {
    expect(select('const n = data.user({ id: "1" }).name')).toEqual({
      user: {__args: '{ id: "1" }', name: true}
    })
  })

  it('marks a scalar-list field even when read whole', () => {
    expect(select('const p = data.me.permissions; use(p)')).toEqual({
      me: {permissions: {__isList: true}}
    })
  })

  it('treats .includes on a scalar list as an intrinsic (not a field)', () => {
    expect(select('const b = data.me.permissions.includes("admin")')).toEqual({
      me: {permissions: {__isList: true}}
    })
  })

  it('follows nested object lists', () => {
    expect(
      select('data.users.map(u => u.posts.map(p => p.title))')
    ).toEqual({
      users: {__isList: true, posts: {__isList: true, title: true}}
    })
  })

  it('handles for-of iteration with destructuring', () => {
    expect(
      select('for (const { id, name } of data.users) { use(id, name) }')
    ).toEqual({users: {__isList: true, id: true, name: true}})
  })

  it('handles numeric index access as element access', () => {
    expect(select('const n = data.users[0].name')).toEqual({
      users: {__isList: true, name: true}
    })
  })

  it('handles .find returning an element', () => {
    expect(
      select('const a = data.users.find(u => u.role === "ADMIN"); use(a.name)')
    ).toEqual({users: {__isList: true, role: true, name: true}})
  })

  it('handles .reduce (element is the second callback param)', () => {
    expect(
      select('const t = data.users.reduce((acc, u) => acc + u.name, "")')
    ).toEqual({users: {__isList: true, name: true}})
  })

  it('does not mark a singular object as a list when wrapped in an array literal', () => {
    // [data.me] is a synthetic array; iterating it yields the singular `me`.
    expect(
      select('const arr = [data.me]; arr.map(x => x.name)')
    ).toEqual({me: {name: true}})
  })

  it('resolves a Relay connection: list edges, singular node', () => {
    expect(
      select('data.posts({ first: 10 }).edges.map(e => e.node.title)')
    ).toEqual({
      posts: {
        __args: '{ first: 10 }',
        edges: {__isList: true, node: {title: true}}
      }
    })
  })
})
