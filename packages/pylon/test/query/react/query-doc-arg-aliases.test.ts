import {buildSchema} from 'graphql'
import {createElement as h} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {describeSchema} from '@/query/build/describe-schema'
import {createPylonQueryClient} from '@/query/runtime/client'
import {doc} from '@/query/runtime/doc'
import {PylonQueryProvider} from '@/query/react/context'
import {useQueryDoc} from '@/query/react/use-query-doc'

// The original ticket-queue-rail snippet, at the root: the same field read twice
// with different args. `timeline` takes an optional arg, so the wrapper exposes
// it as a callable that must route `timeline({query:"kind:EMAIL"})` vs
// `timeline({query:"kind:NOTE"})` to their aliased response slots.
//
// This is the SIBLING of paginated-arg-aliases.test.ts: `useQueryDoc` already
// builds + passes the arg-alias map (unlike the paginated path, which used to
// omit it), and this locks that wiring so it can't regress.
const schema = buildSchema(/* GraphQL */ `
  type Query {
    timeline(query: String): TimelineConnection!
  }
  type TimelineConnection {
    totalCount: Int
  }
`)
const descriptor = describeSchema(schema)

// Mirrors the compiler's output: base `timeline` slot + `timeline__pqArg__1`
// alias, plus the argAliases metadata mapping each branch's args to its variable.
const D = doc<any, any>({
  id: 'q_timeline_counts',
  name: 'TimelineCounts',
  body:
    'query TimelineCounts($v0: String, $v1: String) { ' +
    'timeline(query: $v0) { totalCount __typename } ' +
    'timeline__pqArg__1: timeline(query: $v1) { totalCount __typename } }',
  argAliases: {
    'Query.timeline': [
      {alias: 'timeline', args: {query: 'v0'}},
      {alias: 'timeline__pqArg__1', args: {query: 'v1'}}
    ]
  }
})

// Distinct email/note counts. If the arg-alias map weren't threaded, both callable
// reads would collapse to the base `timeline` slot and notes would equal messages.
const DATA = {
  timeline: {__typename: 'TimelineConnection', totalCount: 18},
  timeline__pqArg__1: {__typename: 'TimelineConnection', totalCount: 2}
}

function Counts() {
  const t = useQueryDoc<any, any>(D, () => ({v0: 'kind:EMAIL', v1: 'kind:NOTE'}))
  const messages = t.timeline({query: 'kind:EMAIL'})?.totalCount ?? 0
  const notes = t.timeline({query: 'kind:NOTE'})?.totalCount ?? 0
  return h('span', null, `${messages}+${notes}`)
}

describe('useQueryDoc threads the arg-alias map into field reads', () => {
  it('routes same-field/different-args root reads to their own slots', async () => {
    const client = createPylonQueryClient({
      descriptor,
      fetcher: vi.fn(async () => ({data: DATA})) as any
    })
    // Seed so `ensure` resolves synchronously during SSR (no thrown suspense
    // promise). Vars must match what the hook reads from its thunk.
    await client.fetch(D, {v0: 'kind:EMAIL', v1: 'kind:NOTE'})

    const html = renderToStaticMarkup(
      h(PylonQueryProvider, {value: client}, h(Counts))
    )

    expect(html).toContain('18+2')
    // The regression signature: notes silently equalling messages.
    expect(html).not.toContain('18+18')
  })
})
