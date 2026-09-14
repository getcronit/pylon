import {buildSchema} from 'graphql'
import {describe, expect, it, vi} from 'vitest'
import {describeSchema} from '@/query/build/describe-schema'
import {createPylonQueryClient} from '@/query/runtime/client'
import {doc} from '@/query/runtime/doc'

/**
 * Repro: an ARG-BEARING field on a shared ENTITY collides across operations.
 *
 * `normalize` keys entity fields by their response name (`normalize.ts`), which omits
 * args. So `ticket.message(id: A)` and `ticket.message(id: B)` both write the bare
 * `message` slot on `Ticket:1` — last write wins. Same-query collisions are aliased
 * (`compile.ts` `__pqArg__N`), but a field selected ONCE per document is never aliased,
 * and the alias registry is per-operation anyway — so two operations reading the same
 * entity's arg-field with different args corrupt each other.
 */
const schema = buildSchema(/* GraphQL */ `
  type Query {
    ticket: Ticket
  }
  type Ticket {
    id: ID!
    message(id: ID!): Message
  }
  type Message {
    id: ID!
    body: String
  }
`)
const descriptor = describeSchema(schema)

// One document, read at two different `message` args (two renders / two components).
// Each selects `message` ONCE, so the compiler emits no same-query arg-alias — the
// response key is the bare `message`.
const D = doc<any, any>({
  id: 'q_ticket_message',
  name: 'TicketMessage',
  body:
    'query TicketMessage($m: ID!) { ' +
    'ticket { id __typename message(id: $m) { id body __typename } } }',
  // What the compiler now emits for the arg-bearing `message` field.
  argSlots: {'Ticket.message': {field: 'message', argVars: {id: 'm'}}},
  // Completeness shape — so the read gate is exercised against the storage-keyed slot too.
  shape: [
    {
      k: 'ticket',
      s: [
        {k: 'id'},
        {k: '__typename'},
        {k: 'message', s: [{k: 'id'}, {k: 'body'}, {k: '__typename'}]}
      ]
    }
  ]
})

const ticketWith = (mid: string, body: string) => ({
  ticket: {
    __typename: 'Ticket',
    id: '1',
    message: {__typename: 'Message', id: mid, body}
  }
})

describe('arg-bearing field on a shared entity', () => {
  it('keeps message(id:A) and message(id:B) distinct across operations', async () => {
    const fetcher = vi.fn(async (req: any) =>
      req.variables.m === 'mA'
        ? {data: ticketWith('mA', 'A body')}
        : {data: ticketWith('mB', 'B body')}
    )
    const client = createPylonQueryClient({descriptor, fetcher: fetcher as any})

    await client.fetch(D, {m: 'mA'})
    await client.fetch(D, {m: 'mB'}) // must NOT clobber A's message on Ticket:1

    const read = (m: string) => {
      const {data} = client.ensure(D, {m})
      return client.wrapDoc<any>(D, () => data, () => ({m}))
    }

    // Each operation must see the message it asked for.
    expect(read('mB').ticket.message({id: 'mB'}).body).toBe('B body') // last write — ok today
    expect(read('mA').ticket.message({id: 'mA'}).body).toBe('A body') // FAILS today → 'B body'
  })
})
