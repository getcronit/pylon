import {describe, expect, it} from 'vitest'
import {mergeEntityFields, Store} from '@/query/runtime/store'

describe('mergeEntityFields (non-destructive entity merge)', () => {
  it('keeps fields absent from the incoming write', () => {
    expect(mergeEntityFields({x: 0, y: 2}, {x: 1})).toEqual({x: 1, y: 2})
  })

  it('does not clobber a sibling op nodes with a totalCount-only write (the partial-read bug)', () => {
    const existing = {
      __typename: 'Contact',
      id: '1',
      affiliations: {__typename: 'AffiliationConnection', totalCount: 2, nodes: [{__ref: 'Affiliation:9'}]}
    }
    const merged = mergeEntityFields(existing, {
      __typename: 'Contact',
      id: '1',
      affiliations: {__typename: 'AffiliationConnection', totalCount: 2}
    })
    // nodes survives the narrower write
    expect((merged.affiliations as any).nodes).toEqual([{__ref: 'Affiliation:9'}])
    expect((merged.affiliations as any).totalCount).toBe(2)
  })

  it('replaces arrays wholesale so a refetch stays authoritative for a list', () => {
    expect(mergeEntityFields({comments: []}, {comments: [{__ref: 'Comment:1'}]})).toEqual({
      comments: [{__ref: 'Comment:1'}]
    })
    expect(mergeEntityFields({comments: [{__ref: 'Comment:1'}, {__ref: 'Comment:2'}]}, {comments: [{__ref: 'Comment:1'}]})).toEqual({
      comments: [{__ref: 'Comment:1'}]
    })
  })

  it('does not let an id-less list (narrow .length read) clobber a ref list (the partial-read bug)', () => {
    // A wide op loaded `values` as identified rows; a narrow op that read only
    // `values.length` selected `values { __typename }` → id-less inline elements.
    const wide = {__typename: 'Attribute', id: 'a', values: [{__ref: 'AttributeValue:1'}, {__ref: 'AttributeValue:2'}]}
    const narrow = {__typename: 'Attribute', id: 'a', values: [{__typename: 'AttributeValue'}, {__typename: 'AttributeValue'}]}
    // narrow write must NOT drop the refs …
    expect(mergeEntityFields(wide, narrow).values).toEqual([{__ref: 'AttributeValue:1'}, {__ref: 'AttributeValue:2'}])
    // … regardless of which op wrote first (a wide refetch still wins over id-less).
    expect(mergeEntityFields(narrow, wide).values).toEqual([{__ref: 'AttributeValue:1'}, {__ref: 'AttributeValue:2'}])
  })

  it('a genuine list update (refs / empty) still replaces wholesale', () => {
    // refetch that shrinks a list carries refs → wins
    expect(mergeEntityFields({values: [{__ref: 'V:1'}, {__ref: 'V:2'}]}, {values: [{__ref: 'V:1'}]}).values).toEqual([{__ref: 'V:1'}])
    // cleared list (empty) → wins
    expect(mergeEntityFields({values: [{__ref: 'V:1'}]}, {values: []}).values).toEqual([])
    // list of genuinely id-less value objects still updates (no refs to protect)
    expect(mergeEntityFields({tags: [{name: 'a'}]}, {tags: [{name: 'b'}]}).tags).toEqual([{name: 'b'}])
  })

  it('replaces refs rather than recursing into them', () => {
    expect(mergeEntityFields({rel: {__ref: 'B:1'}}, {rel: {__ref: 'B:2'}})).toEqual({rel: {__ref: 'B:2'}})
  })

  it('never lets undefined erase a loaded field', () => {
    expect(mergeEntityFields({x: 5}, {x: undefined})).toEqual({x: 5})
  })

  it('returns incoming when there is no existing entity', () => {
    expect(mergeEntityFields(undefined, {a: 1})).toEqual({a: 1})
  })
})

// Structural sharing: a merge that changes nothing must return the SAME object
// (and keep unchanged nested arrays/objects/refs by identity). This is the store
// half of read-path identity — an entity untouched by a refetch keeps its object
// reference, which is what lets a wrapped node stay `===` across renders (and a
// `React.memo`'d feed row skip). Without it, every refetch mints fresh objects for
// every entity and identity is impossible upstream.
describe('mergeEntityFields structural sharing', () => {
  it('returns the SAME object when the write changes nothing', () => {
    const existing = {__typename: 'T', id: '1', a: 1, b: 'two'}
    expect(mergeEntityFields(existing, {a: 1, b: 'two'})).toBe(existing)
  })

  it('keeps an unchanged ref field by identity (a fresh {__ref} equal by target)', () => {
    const existing = {id: '1', user: {__ref: 'User:9'}}
    // Incoming carries a DIFFERENT {__ref} object with the same target — a refetch
    // always re-materializes refs. Value-equal ⇒ the entity must not change identity.
    expect(mergeEntityFields(existing, {user: {__ref: 'User:9'}})).toBe(existing)
  })

  it('keeps an unchanged ref-list by identity (array and entity both stable)', () => {
    const existing = {id: '1', nodes: [{__ref: 'A:1'}, {__ref: 'A:2'}]}
    const merged = mergeEntityFields(existing, {nodes: [{__ref: 'A:1'}, {__ref: 'A:2'}]})
    expect(merged).toBe(existing)
    expect(merged.nodes).toBe(existing.nodes)
  })

  it('shares the unchanged parts and replaces only what changed', () => {
    const existing = {id: '1', a: 1, sub: {__typename: 'S', x: 1}}
    const merged = mergeEntityFields(existing, {a: 2, sub: {__typename: 'S', x: 1}})
    expect(merged).not.toBe(existing) // `a` changed → new top-level object
    expect(merged.a).toBe(2)
    expect(merged.sub).toBe(existing.sub) // `sub` unchanged → shared by identity
  })

  it('Store.mergeEntities keeps an unchanged entity stable across an identical refetch', () => {
    const store = new Store()
    store.mergeEntities({'T:1': {__typename: 'T', id: '1', title: 'Hi', author: {__ref: 'User:2'}}})
    const first = store.getEntity('T:1')
    // Identical refetch (the use-live-events case): same data, fresh objects on the wire.
    store.mergeEntities({'T:1': {__typename: 'T', id: '1', title: 'Hi', author: {__ref: 'User:2'}}})
    expect(store.getEntity('T:1')).toBe(first)
    // A real change still produces a new object.
    store.mergeEntities({'T:1': {__typename: 'T', id: '1', title: 'Bye', author: {__ref: 'User:2'}}})
    expect(store.getEntity('T:1')).not.toBe(first)
    expect(store.getEntity('T:1')!.title).toBe('Bye')
  })
})
