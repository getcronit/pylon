import {describe, expect, it} from 'vitest'
import {generatePrepare} from './selectors-to-prepare'

describe('generatePrepare', () => {
  it('should generate basic object access', () => {
    const output = generatePrepare({user: {name: true, age: true}})
    expect(output).toBe(
      '({ query }) => { query?.user?.name; query?.user?.age; }'
    )
  })

  it('should generate array mapping scopes', () => {
    const output = generatePrepare({posts: {__isList: true, title: true}})
    expect(output).toBe(
      '({ query }) => { query?.posts?.map(i1 => { i1?.title; }); }'
    )
  })

  it('should handle function arguments', () => {
    const output = generatePrepare({
      friends: {__args: '{ limit: 10, offset: 20 }', name: true}
    })
    expect(output).toBe(
      '({ query }) => { query?.friends?.({ limit: 10, offset: 20 })?.name; }'
    )
  })

  it('should handle empty function arguments', () => {
    const output = generatePrepare({user: {__args: '', name: true}})
    expect(output).toBe('({ query }) => { query?.user?.()?.name; }')
  })

  it('should handle array mapping scopes with arguments', () => {
    const output = generatePrepare({
      friends: {__args: '{ limit: 10 }', __isList: true, name: true}
    })
    expect(output).toBe(
      '({ query }) => { query?.friends?.({ limit: 10 })?.map(i1 => { i1?.name; }); }'
    )
  })

  it('should deeply nest scopes accurately', () => {
    const output = generatePrepare({
      feed: {
        __isList: true,
        author: {name: true},
        comments: {
          __isList: true,
          text: true
        }
      }
    })
    expect(output).toBe(
      '({ query }) => { query?.feed?.map(i1 => { i1?.author?.name; i1?.comments?.map(i2 => { i2?.text; }); }); }'
    )
  })

  it('should handle functions with arguments that return a primitive value', () => {
    const output = generatePrepare({user: {__args: '{id: 1}'}})
    expect(output).toBe('({ query }) => { query?.user?.({id: 1}); }')
  })
})
