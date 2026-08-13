import {describe, expect, it} from 'vitest'
import {mergeEntityFields} from '@/query/runtime/store'

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
