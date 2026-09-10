import {afterAll, beforeEach, describe, expect, it} from 'vitest'
import {Pylon} from '@/core'
import {
  __setRootLogger,
  createLogger,
  getLogger,
  getRootLogger,
  setAccessLog,
  type LogRecord
} from '@/core/logger'

// Swap the root logger for a captured sink so the pipeline's access line + in-handler logs are
// inspectable, then drive requests through the real base pipeline via `app.fetch`.
const original = getRootLogger()
let captured: LogRecord[] = []

function buildApp(): Pylon<any> {
  const app = new Pylon({graphql: {Query: {ping: (): string => 'ok'}, Mutation: {}}})
  app.installBasePipeline()
  app.get('/hello', c => {
    getLogger().info('in-handler', {route: 'hello'})
    return c.text('ok')
  })
  app.get('/__pylon/static/x', c => c.text('asset'))
  return app
}

beforeEach(() => {
  captured = []
  __setRootLogger(createLogger({level: 'trace', sink: r => captured.push(r)}))
  setAccessLog(true)
})
afterAll(() => {
  __setRootLogger(original)
  setAccessLog(true)
})

const access = () => captured.find(r => r.msg === 'request')

describe('request pipeline logging', () => {
  it('emits a structured access line and correlates getLogger() in the handler', async () => {
    const res = await buildApp().fetch(
      new Request('http://x/hello', {headers: {'x-request-id': 'rid-1'}})
    )
    expect(res.status).toBe(200)
    expect(access()).toMatchObject({
      requestId: 'rid-1',
      method: 'GET',
      path: '/hello',
      status: 200,
      tag: 'http'
    })
    expect(typeof access()!.durationMs).toBe('number')
    expect(captured.find(r => r.msg === 'in-handler')).toMatchObject({
      requestId: 'rid-1',
      tag: 'http',
      route: 'hello'
    })
  })

  it('generates a request id when the request carries none', async () => {
    await buildApp().fetch(new Request('http://x/hello'))
    expect(typeof access()!.requestId).toBe('string')
    expect((access()!.requestId as string).length).toBeGreaterThan(0)
  })

  it('skips the access line for /__pylon/* static assets', async () => {
    await buildApp().fetch(new Request('http://x/__pylon/static/x'))
    expect(access()).toBeUndefined()
  })

  it('logger:false disables the access line but keeps getLogger() working', async () => {
    setAccessLog(false)
    await buildApp().fetch(new Request('http://x/hello'))
    expect(access()).toBeUndefined()
    expect(captured.find(r => r.msg === 'in-handler')).toBeDefined()
  })
})
