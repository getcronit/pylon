import {afterEach, describe, expect, it} from 'vitest'
import {runJobWithLogging, setJobRunner} from '@/queues/queue'
import {
  __setRootLogger,
  createLogger,
  getLogger,
  getRootLogger,
  type LogRecord
} from '@/core/logger'

const original = getRootLogger()

afterEach(() => {
  __setRootLogger(original)
  setJobRunner((_j, fn) => fn())
})

describe('runJobWithLogging', () => {
  it('scopes the processor logger and fans records to stdout + job.log', async () => {
    const out: LogRecord[] = []
    __setRootLogger(createLogger({level: 'trace', sink: r => out.push(r)}))

    const jobLogLines: string[] = []
    const job = {
      id: 'j1',
      attemptsMade: 0,
      data: {to: 'x@example.com'},
      log: async (m: string) => void jobLogLines.push(m)
    }

    await runJobWithLogging('email', job as never, job.data, async ({data, log}) => {
      getLogger().info('sending', {to: data.to}) // → stdout + job.log
      getLogger().debug('smtp handshake') // → stdout only (below the job.log info threshold)
      await log('legacy line') // ctx.log → getLogger().info → stdout + job.log
    })

    // stdout: correlated ({queue, jobId, attempt}) + tagged queue:email
    const sending = out.find(r => r.msg === 'sending')
    expect(sending).toMatchObject({
      queue: 'email',
      jobId: 'j1',
      attempt: 1,
      tag: 'queue:email',
      to: 'x@example.com'
    })
    expect(out.find(r => r.msg === 'smtp handshake')).toBeDefined() // debug on stdout

    // job.log (dashboard): info + the legacy line, but NOT the debug (below threshold)
    expect(jobLogLines.some(l => l.includes('sending'))).toBe(true)
    expect(jobLogLines.some(l => l.includes('legacy line'))).toBe(true)
    expect(jobLogLines.some(l => l.includes('smtp handshake'))).toBe(false)
  })

  it('runs the processor through the jobRunner seam (getDatabase().run analogue)', async () => {
    __setRootLogger(createLogger({level: 'trace', sink: () => {}}))
    const order: string[] = []
    setJobRunner((_job, fn) => {
      order.push('runner:before')
      return fn().finally(() => order.push('runner:after'))
    })
    const job = {id: 'j2', attemptsMade: 1, data: 1, log: async () => {}}
    await runJobWithLogging('q', job as never, 1, async () => {
      order.push('handler')
    })
    expect(order).toEqual(['runner:before', 'handler', 'runner:after'])
  })
})
