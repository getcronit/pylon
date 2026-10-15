import {afterAll, beforeEach, describe, expect, it} from 'vitest'
import {Pylon} from '@/core'
import {
  __setRootLogger,
  createLogger,
  getRootLogger,
  type LogRecord
} from '@/core/logger'

const original = getRootLogger()
let captured: LogRecord[] = []

beforeEach(() => {
  captured = []
  __setRootLogger(createLogger({level: 'trace', sink: r => captured.push(r)}))
})
afterAll(() => __setRootLogger(original))

const errorLogs = () => captured.filter(r => r.msg === 'unhandled route error')

describe('route error logging (Pylon.onError)', () => {
  it('logs unexpected route errors at error; expected denials stay quiet', async () => {
    const app = new Pylon({graphql: {Query: {ping: (): string => 'ok'}, Mutation: {}}})
    app.installBasePipeline()
    app.get('/throw', () => {
      throw new Error('boom')
    })
    app.get('/deny', () => {
      const e = new Error('nope') as Error & {statusCode?: number}
      e.statusCode = 403
      throw e
    })

    const r1 = await app.fetch(new Request('http://x/throw', {headers: {'x-request-id': 'rid-e'}}))
    expect(r1.status).toBe(500)
    expect(errorLogs()).toHaveLength(1)
    expect(errorLogs()[0].level).toBe('error')
    expect(errorLogs()[0].requestId).toBe('rid-e') // correlated (ALS reaches onError)
    expect((errorLogs()[0].err as {message?: string}).message).toBe('boom')

    const r2 = await app.fetch(new Request('http://x/deny'))
    expect(r2.status).toBe(403)
    // still just the one — the expected 403 denial did not log
    expect(errorLogs()).toHaveLength(1)
  })
})

describe('graphql error logging (useGraphqlErrorLogger)', () => {
  it('logs unexpected errors at error and client GraphQLErrors at debug', async () => {
    const {GraphQLError} = await import('graphql')
    const {useGraphqlErrorLogger} = await import('@/plugins/use-graphql-error-logger')

    // A GraphQLError wrapping a thrown exception = unexpected (server); a plain one = client.
    const serverErr = new GraphQLError('boom', {
      originalError: new Error('resolver failed'),
      path: ['boom']
    })
    const clientErr = new GraphQLError('bad query', {path: ['x']})

    const hooks = (
      useGraphqlErrorLogger() as {onExecute(): {onExecuteDone(p: unknown): unknown}}
    ).onExecute()
    hooks.onExecuteDone({result: {errors: [serverErr, clientErr]}, setResult() {}})

    const err = captured.find(r => r.msg === 'graphql error')
    const dbg = captured.find(r => r.msg === 'graphql client error')
    expect(err?.level).toBe('error')
    expect(err?.tag).toBe('graphql') // root + withTag('graphql') (no request scope here)
    expect((err?.err as {message?: string}).message).toBe('resolver failed')
    expect(dbg?.level).toBe('debug')
    expect(dbg?.message).toBe('bad query')
  })
})
