import {buildSchema} from 'graphql'
import {describe, expect, it, vi} from 'vitest'
import {describeSchema} from '@/query/build/describe-schema'
import {createPylonQueryClient} from '@/query/runtime/client'
import {doc} from '@/query/runtime/doc'

// The `Date` scalar crosses the wire as an ISO string while the generated types
// say `Date`. Nothing reconciled the two, so `.toISOString()` type-checked and
// threw at runtime — a 500 on every page that touched a date, past tsc.
const schema = buildSchema(/* GraphQL */ `
  scalar Date
  type Query {
    article: Article
  }
  type Article {
    title: String
    publishedAt: Date
    revisions: [Date!]
    missing: Date
    broken: Date
  }
`)
const descriptor = describeSchema(schema)

const D = doc<any, any>({
  id: 'q_article',
  name: 'Article',
  body:
    'query Article { article { title publishedAt revisions missing broken __typename } }'
})

const DATA = {
  article: {
    __typename: 'Article',
    title: 'A post',
    publishedAt: '2026-06-12T00:00:00.000Z',
    revisions: ['2026-06-12T00:00:00.000Z', '2026-07-01T09:30:00.000Z'],
    missing: null,
    broken: 'not-a-date'
  }
}

const read = () => {
  const client = createPylonQueryClient({
    descriptor,
    fetcher: vi.fn(async () => ({data: DATA})) as any
  })
  return client.wrapDoc<any>(D, () => DATA)
}

describe('the Date scalar', () => {
  it('reads back as a Date, not a string', () => {
    const at = read().article.publishedAt
    expect(at).toBeInstanceOf(Date)
    expect(at.toISOString()).toBe('2026-06-12T00:00:00.000Z')
  })

  it('keeps identity across reads, so effect deps do not churn', () => {
    const root = read()
    expect(root.article.publishedAt).toBe(root.article.publishedAt)
  })

  it('revives inside a list', () => {
    const revisions = read().article.revisions
    expect(revisions).toHaveLength(2)
    expect(revisions[0]).toBeInstanceOf(Date)
    expect(revisions[1]).toBeInstanceOf(Date)
  })

  it('leaves null alone', () => {
    expect(read().article.missing).toBeNull()
  })

  it('passes an unparseable value through rather than making an Invalid Date', () => {
    expect(read().article.broken).toBe('not-a-date')
  })

  it('does not touch other scalars', () => {
    expect(read().article.title).toBe('A post')
  })
})
