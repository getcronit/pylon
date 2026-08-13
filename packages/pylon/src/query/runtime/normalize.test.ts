import {describe, expect, it} from 'vitest'
import {entityKey, isRef, normalize} from './normalize'
import {wrapResult} from './wrap'
import type {SchemaDescriptor} from './descriptor'

describe('normalize', () => {
  it('hoists objects with __typename + id into the entity table', () => {
    const {root, entities} = normalize({
      me: {__typename: 'User', id: '1', name: 'Ada'}
    })
    expect(root).toEqual({me: {__ref: 'User:1'}})
    expect(entities['User:1']).toEqual({__typename: 'User', id: '1', name: 'Ada'})
  })

  it('strips the __pqAbs__ branch alias back to the base field', () => {
    // The compiler aliases a union-member field whose type conflicts across members
    // (e.g. `status` is TaskStatus on Task but TicketStatus on Ticket) as
    // `status__pqAbs__Task: status`. Only the matched member's alias is present, so
    // normalize restores `status` transparently for reads.
    const {entities} = normalize({
      hit: {__typename: 'Task', id: 't1', status__pqAbs__Task: 'TODO', label: 'x'}
    })
    expect(entities['Task:t1']).toEqual({
      __typename: 'Task',
      id: 't1',
      status: 'TODO',
      label: 'x'
    })
  })

  it('leaves objects without an id inline', () => {
    const {root, entities} = normalize({
      page: {__typename: 'DocPage', title: 'X'}
    })
    expect(root).toEqual({page: {__typename: 'DocPage', title: 'X'}})
    expect(Object.keys(entities)).toHaveLength(0)
  })

  it('normalizes nested entities and lists', () => {
    const {root, entities} = normalize({
      posts: [
        {__typename: 'Post', id: 'p1', author: {__typename: 'User', id: 'u1', name: 'A'}}
      ]
    })
    expect(root).toEqual({posts: [{__ref: 'Post:p1'}]})
    expect(entities['Post:p1'].author).toEqual({__ref: 'User:u1'})
    expect(entities['User:u1']).toEqual({__typename: 'User', id: 'u1', name: 'A'})
  })

  it('shallow-merges the same entity across selections', () => {
    const {entities} = normalize({
      a: {__typename: 'User', id: '1', name: 'Ada'},
      b: {__typename: 'User', id: '1', email: 'ada@x.com'}
    })
    expect(entities['User:1']).toEqual({
      __typename: 'User',
      id: '1',
      name: 'Ada',
      email: 'ada@x.com'
    })
  })
})

// A wrapper-level proof that two operations sharing an entity see the same data,
// and that patching the entity table updates both reads.
describe('normalized reads (cross-query consistency)', () => {
  const descriptor: SchemaDescriptor = {
    query: 'Query',
    types: {
      Query: {me: {type: 'User'}, viewer: {type: 'User'}},
      User: {id: {type: 'ID', scalar: true}, name: {type: 'String', scalar: true}}
    }
  }

  it('two roots referencing one entity reflect a patch', () => {
    const table = new Map<string, Record<string, unknown>>()
    const deref = (v: any) => (isRef(v) ? table.get(v.__ref) : v)

    const seed = (data: unknown) => {
      const {entities} = normalize(data)
      for (const k of Object.keys(entities))
        table.set(k, {...table.get(k), ...entities[k]})
    }

    seed({me: {__typename: 'User', id: '1', name: 'Ada'}})
    const rootA = normalize({me: {__typename: 'User', id: '1', name: 'Ada'}}).root
    const rootB = normalize({viewer: {__typename: 'User', id: '1', name: 'Ada'}}).root

    const a = wrapResult<any>(() => rootA, descriptor, undefined, deref)
    const b = wrapResult<any>(() => rootB, descriptor, undefined, deref)
    expect(a.me.name).toBe('Ada')
    expect(b.viewer.name).toBe('Ada')

    // Patch the canonical entity → both reads update.
    table.set('User:1', {...table.get('User:1'), name: 'Ada Lovelace'})
    expect(a.me.name).toBe('Ada Lovelace')
    expect(b.viewer.name).toBe('Ada Lovelace')
    expect(entityKey('User', '1')).toBe('User:1')
  })
})
