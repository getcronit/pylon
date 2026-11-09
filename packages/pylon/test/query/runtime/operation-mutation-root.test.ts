import {buildSchema} from 'graphql'
import {describe, expect, it, vi} from 'vitest'
import {describeSchema} from '@/query/build/describe-schema'
import {createPylonQueryClient} from '@/query/runtime/client'
import {doc} from '@/query/runtime/doc'
import {op, registerOperationClient} from '@/query/runtime/operation'

// `op.mutation` sends its compiled document and then re-runs the selector
// against the wrapped result to project it. That wrap used to resolve fields
// against the QUERY root, where a mutation field does not exist — so the field
// descriptor lookup missed, `callable` was undefined, and calling the field
// threw `is not a function`. AFTER the mutation had run: the write landed, and
// only reading the result failed.
const schema = buildSchema(/* GraphQL */ `
  type Query {
    ping: String
  }
  type Mutation {
    subscribe(email: String!): SubscribeResult!
  }
  type SubscribeResult {
    success: Boolean
  }
`)
const descriptor = describeSchema(schema)

const M = doc<any, any>({
  id: 'm_subscribe',
  name: 'Subscribe',
  body:
    'mutation Subscribe($v0: String!) { ' +
    'subscribe(email: $v0) { success __typename } }'
})

describe('op.mutation projects against the mutation root', () => {
  it('reads a field that takes arguments', async () => {
    const client = createPylonQueryClient({
      descriptor,
      fetcher: vi.fn(async () => ({
        data: {subscribe: {__typename: 'SubscribeResult', success: true}}
      })) as any
    })
    registerOperationClient(client)

    // Mirrors the analyzer's rewrite: op.mutation(doc, variablesThunk, selector).
    const result = await (op.mutation as any)(
      M,
      () => ({v0: 'someone@example.com'}),
      (m: any) => m.subscribe({email: 'someone@example.com'})
    )

    expect(result?.success).toBe(true)
  })

  it('does not throw "is not a function" for the mutation field', async () => {
    const client = createPylonQueryClient({
      descriptor,
      fetcher: vi.fn(async () => ({
        data: {subscribe: {__typename: 'SubscribeResult', success: true}}
      })) as any
    })
    registerOperationClient(client)

    // The regression signature: the request succeeded and the projection threw,
    // so a caller saw a failure for a mutation that had already been applied.
    await expect(
      (op.mutation as any)(M, () => ({v0: 'x@example.com'}), (m: any) =>
        m.subscribe({email: 'x@example.com'})
      )
    ).resolves.toBeTruthy()
  })
})
