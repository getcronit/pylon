import {buildSchema, parse, validate} from 'graphql'
import {describe, expect, it} from 'vitest'
import {compileOperation, type SelectorNode} from '@/query/build/compile'
import {describeSchema} from '@/query/build/describe-schema'
import {isRef, normalize} from '@/query/runtime/normalize'
import {wrapResult} from '@/query/runtime/wrap'

/**
 * Two structural hazards when the analyzer merges reads across the members of an
 * interface/union: a field NAME shared by members whose sub-shapes differ. The
 * compiler must partition the merged selection per member so the emitted document
 * is valid GraphQL — proven here by running the server's own validation over it.
 */

// ── Gap 1: a shared field name with DIFFERENT object sub-types ────────────────
// `items` is `[TimelineEntry!]!` on one member and `[NumberedEntry!]!` on another;
// the analyzer records the union of both sub-selections under `blocks.items`.
const objSubtypeSchema = buildSchema(/* GraphQL */ `
  type Query {
    blocks: [Block!]!
  }
  union Block = TimelineBlock | NumberedListBlock
  type TimelineBlock {
    id: ID!
    items: [TimelineEntry!]!
  }
  type NumberedListBlock {
    id: ID!
    items: [NumberedEntry!]!
  }
  type TimelineEntry {
    label: String
    text: String
  }
  type NumberedEntry {
    marker: String
    title: String
  }
`)

// ── Gap 2: a shared field name differing only in NULLABILITY ──────────────────
const nullabilitySchema = buildSchema(/* GraphQL */ `
  type Query {
    blocks: [Block!]!
  }
  union Block = HeroBlock | StoryBlock
  type HeroBlock {
    id: ID!
    title: String!
    image: BlockImage!
  }
  type StoryBlock {
    id: ID!
    title: String
    image: BlockImage
  }
  type BlockImage {
    url: String!
  }
`)

const validationErrors = (schema: Parameters<typeof validate>[0], body: string) =>
  validate(schema, parse(body)).map(e => e.message)

describe('polymorphic field-name merges compile to valid GraphQL', () => {
  it('partitions a shared field name with different object sub-types per member', () => {
    // The union of both members' entry fields, as the analyzer would record it.
    const selectors: SelectorNode = {
      blocks: {items: {label: true, text: true, marker: true, title: true}}
    }
    const op = compileOperation(objSubtypeSchema, selectors, {name: 'Blocks'})

    // Each member's `items` selects ONLY the fields valid for its own entry type.
    expect(op.body).toMatch(/on TimelineBlock \{[^}]*\bitems[^}]*\blabel\b[^}]*\btext\b/)
    expect(op.body).not.toMatch(/on TimelineBlock \{[^}]*\bmarker\b/)
    expect(op.body).toMatch(/on NumberedListBlock \{[^}]*\bitems[^}]*\bmarker\b[^}]*\btitle\b/)
    expect(op.body).not.toMatch(/on NumberedListBlock \{[^}]*\blabel\b/)

    // And the whole thing is valid GraphQL the server won't reject.
    expect(validationErrors(objSubtypeSchema, op.body)).toEqual([])
  })

  it('aliases a shared field name that differs only in nullability', () => {
    const selectors: SelectorNode = {
      blocks: {title: true, image: {url: true}}
    }
    const op = compileOperation(nullabilitySchema, selectors, {name: 'Blocks'})

    // `String!` vs `String` (and `BlockImage!` vs `BlockImage`) must be aliased
    // apart — GraphQL's SameResponseShape rule rejects them under one response key
    // even across mutually-exclusive fragments.
    expect(op.body).toContain('title__pqAbs__HeroBlock: title')
    expect(op.body).toContain('title__pqAbs__StoryBlock: title')
    expect(op.body).toContain('image__pqAbs__HeroBlock: image')
    expect(op.body).toContain('image__pqAbs__StoryBlock: image')

    expect(validationErrors(nullabilitySchema, op.body)).toEqual([])
  })

  it('still fails loud on a nested field present on no member', () => {
    // Partitioning must not silently DROP a genuinely-unknown sub-field.
    const selectors: SelectorNode = {
      blocks: {items: {label: true, bogus: true}}
    }
    expect(() =>
      compileOperation(objSubtypeSchema, selectors, {name: 'Blocks'})
    ).toThrow(/bogus/)
  })

  it('reads back through the aliases at runtime (normalize → wrap)', () => {
    // The wire aliases must un-alias on normalize so reads stay `node.items`, with
    // the right member's shape dispatched by __typename.
    const descriptor = describeSchema(objSubtypeSchema)
    const serverData = {
      blocks: [
        {
          __typename: 'TimelineBlock',
          id: 't1',
          items__pqAbs__TimelineBlock: [
            {__typename: 'TimelineEntry', label: 'A', text: 'a'}
          ]
        },
        {
          __typename: 'NumberedListBlock',
          id: 'n1',
          items__pqAbs__NumberedListBlock: [
            {__typename: 'NumberedEntry', marker: '1.', title: 'One'}
          ]
        }
      ]
    }
    const {root, entities} = normalize(serverData)
    const deref = (v: any) => (isRef(v) ? entities[v.__ref] : v)
    const data = wrapResult<any>(() => root, descriptor, undefined, deref)

    expect(data.blocks[0].__typename).toBe('TimelineBlock')
    expect(data.blocks[0].items[0].label).toBe('A')
    expect(data.blocks[0].items[0].text).toBe('a')
    expect(data.blocks[1].__typename).toBe('NumberedListBlock')
    expect(data.blocks[1].items[0].marker).toBe('1.')
    expect(data.blocks[1].items[0].title).toBe('One')
  })
})
