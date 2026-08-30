import {buildSchema} from 'graphql'
import {createElement as h} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {describeSchema} from '@/query/build/describe-schema'
import {createPylonQueryClient} from '@/query/runtime/client'
import {doc} from '@/query/runtime/doc'
import {PylonQueryProvider} from '@/query/react/context'
import {usePaginatedDoc} from '@/query/react/use-paginated-doc'

// A ticket-list connection whose NODES each expose a `timeline` relation read
// twice with different args — exactly the ticket-queue-rail shape. `timeline`
// takes an optional arg, so the wrapper exposes it as a callable that must route
// `timeline({query:"kind:EMAIL"})` vs `timeline({query:"kind:NOTE"})` to their
// aliased response slots.
const schema = buildSchema(/* GraphQL */ `
  type Query {
    tickets(first: Int, after: String): TicketConnection!
  }
  type TicketConnection {
    edges: [TicketEdge!]!
    pageInfo: PageInfo!
    totalCount: Int
  }
  type TicketEdge {
    cursor: String!
    node: Ticket!
  }
  type Ticket {
    id: ID!
    timeline(query: String): TimelineConnection!
  }
  type TimelineConnection {
    totalCount: Int
  }
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }
`)
const descriptor = describeSchema(schema)

// Hand-authored to mirror the compiler's output for the two different-args reads:
// the base `timeline` slot + a `timeline__pqArg__1` alias, plus the argAliases
// metadata mapping each branch's args to its variable.
const D = doc<any, any>({
  id: 'q_tickets_timeline',
  name: 'TicketQueue',
  body:
    'query TicketQueue($v0: String, $v1: String, $first: Int, $after: String) { ' +
    'tickets(first: $first, after: $after) { edges { cursor node { ' +
    'timeline(query: $v0) { totalCount __typename } ' +
    'timeline__pqArg__1: timeline(query: $v1) { totalCount __typename } ' +
    '__typename id } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } __typename } }',
  connection: {path: ['tickets'], first: 'first', after: 'after'},
  argAliases: {
    'Ticket.timeline': [
      {alias: 'timeline', args: {query: 'v0'}},
      {alias: 'timeline__pqArg__1', args: {query: 'v1'}}
    ]
  }
})

// Two tickets with DISTINCT email/note counts. If the arg-alias map isn't threaded
// through the connection read, both callable reads collapse to the base `timeline`
// slot and every row's notes count equals its messages count.
const CONNECTION_DATA = {
  tickets: {
    __typename: 'TicketConnection',
    edges: [
      {
        cursor: 'c1',
        node: {
          __typename: 'Ticket',
          id: 't1',
          timeline: {__typename: 'TimelineConnection', totalCount: 18},
          timeline__pqArg__1: {__typename: 'TimelineConnection', totalCount: 2}
        }
      },
      {
        cursor: 'c2',
        node: {
          __typename: 'Ticket',
          id: 't2',
          timeline: {__typename: 'TimelineConnection', totalCount: 6},
          timeline__pqArg__1: {__typename: 'TimelineConnection', totalCount: 1}
        }
      }
    ],
    pageInfo: {
      __typename: 'PageInfo',
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: 'c1',
      endCursor: 'c2'
    }
  }
}

function Rows() {
  const r = usePaginatedDoc(D, () => ({v0: 'kind:EMAIL', v1: 'kind:NOTE'}))
  return h(
    'ul',
    null,
    r.nodes.map((n: any) => {
      const messages = n.timeline({query: 'kind:EMAIL'})?.totalCount ?? 0
      const notes = n.timeline({query: 'kind:NOTE'})?.totalCount ?? 0
      return h('li', {key: n.id}, `${messages}+${notes}`)
    })
  )
}

describe('usePaginatedDoc threads the arg-alias map into connection reads', () => {
  it('routes same-field/different-args node reads to their own slots', async () => {
    const client = createPylonQueryClient({
      descriptor,
      fetcher: vi.fn(async () => ({data: CONNECTION_DATA})) as any
    })
    // Seed the head window so `ensure` resolves synchronously during SSR (no
    // thrown suspense promise). Vars must match the head window the hook reads:
    // base arg-alias vars + the default page size on the `first` var.
    await client.fetch(D, {v0: 'kind:EMAIL', v1: 'kind:NOTE', first: 20})

    const html = renderToStaticMarkup(
      h(PylonQueryProvider, {value: client}, h(Rows))
    )

    // messages (EMAIL) and notes (NOTE) must differ per row.
    expect(html).toContain('18+2')
    expect(html).toContain('6+1')
    // The regression signature: notes silently equalling messages.
    expect(html).not.toContain('18+18')
    expect(html).not.toContain('6+6')
  })
})
