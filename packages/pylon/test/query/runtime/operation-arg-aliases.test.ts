import {buildSchema} from 'graphql'
import {describe, expect, it, vi} from 'vitest'
import {describeSchema} from '@/query/build/describe-schema'
import {createPylonQueryClient} from '@/query/runtime/client'
import {doc} from '@/query/runtime/doc'
import {op, registerOperationClient} from '@/query/runtime/operation'

// The imperative `op` path wraps its fetched result too — and, like the hook read
// paths, must route same-field/different-args reads in the selector to their own
// aliased slots. It used to wrap via raw `wrapData` (no map) and would have
// collapsed both reads to the base slot; routing now goes through `wrapDoc`.
const schema = buildSchema(/* GraphQL */ `
  type Query {
    timeline(query: String): TimelineConnection!
  }
  type TimelineConnection {
    totalCount: Int
  }
`)
const descriptor = describeSchema(schema)

const D = doc<any, any>({
  id: 'q_op_timeline',
  name: 'OpTimeline',
  body:
    'query OpTimeline($v0: String, $v1: String) { ' +
    'timeline(query: $v0) { totalCount __typename } ' +
    'timeline__pqArg__1: timeline(query: $v1) { totalCount __typename } }',
  argAliases: {
    'Query.timeline': [
      {alias: 'timeline', args: {query: 'v0'}},
      {alias: 'timeline__pqArg__1', args: {query: 'v1'}}
    ]
  }
})

const DATA = {
  timeline: {__typename: 'TimelineConnection', totalCount: 18},
  timeline__pqArg__1: {__typename: 'TimelineConnection', totalCount: 2}
}

describe('op routes same-field/different-args reads via wrapDoc', () => {
  it('the selector reads distinct counts per args', async () => {
    const client = createPylonQueryClient({
      descriptor,
      fetcher: vi.fn(async () => ({data: DATA})) as any
    })
    registerOperationClient(client)

    // Mirrors the analyzer's rewrite: op.query(doc, variablesThunk, selector).
    const result = await (op.query as any)(
      D,
      () => ({v0: 'kind:EMAIL', v1: 'kind:NOTE'}),
      (q: any) => ({
        messages: q.timeline({query: 'kind:EMAIL'})?.totalCount ?? 0,
        notes: q.timeline({query: 'kind:NOTE'})?.totalCount ?? 0
      })
    )

    expect(result).toEqual({messages: 18, notes: 2})
    // Regression signature: notes silently equalling messages.
    expect(result.notes).not.toBe(result.messages)
  })
})
