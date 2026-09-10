import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {useQueues} from '@/queues/plugin'
import {runJobWithLogging, setJobRunner} from '@/queues/queue'
import {getOutboxDriver, setOutboxDriver} from '@/queues/outbox'
import {setDefaultDatabase} from '@/db/database'
import {__setRootLogger, createLogger, getRootLogger} from '@/core/logger'

// A queues-only app — `plugins: [useQueues()]` with NO `useDatabase()` — must
// NOT bind the per-job ORM runner or the outbox. Otherwise every job's runner
// wraps `getDatabase().run(...)`, which throws "No active database", failing
// 100% of jobs even though the processors never touch the ORM.

const originalLogger = getRootLogger()

beforeEach(() => {
  // Ensure no process-wide default DB leaks in from another suite, and reset the
  // job-runner + outbox to their pristine (unbound) state.
  setDefaultDatabase(undefined)
  setJobRunner((_job, fn) => fn())
  setOutboxDriver(undefined)
})

afterEach(() => {
  __setRootLogger(originalLogger)
  setDefaultDatabase(undefined)
  setJobRunner((_job, fn) => fn())
  setOutboxDriver(undefined)
})

describe('useQueues() without a connected database', () => {
  it('leaves the default passthrough job runner and sets no outbox driver', async () => {
    await useQueues().setup()

    // No outbox driver was wired (nothing to persist to without a DB).
    expect(getOutboxDriver()).toBeUndefined()

    // The default (passthrough) runner is still in place, so a job runs its
    // processor directly instead of failing with "No active database".
    const ran: string[] = []
    const job = {id: 'j1', attemptsMade: 0, data: 1, log: async () => {}}
    await expect(
      runJobWithLogging('q', job as never, 1, async () => {
        ran.push('processed')
      })
    ).resolves.toBeUndefined()
    expect(ran).toEqual(['processed'])
  })

  it('warns when outbox: true is explicitly set but no database is connected', async () => {
    const records: {level: string; msg: string; tag?: string}[] = []
    __setRootLogger(
      createLogger({
        level: 'trace',
        sink: r => records.push({level: r.level, msg: r.msg, tag: r.tag})
      })
    )

    await useQueues({outbox: true}).setup()

    expect(getOutboxDriver()).toBeUndefined()
    const warned = records.find(
      r => r.level === 'warn' && r.msg.includes('outbox: true')
    )
    expect(warned).toBeDefined()
    expect(warned?.tag).toBe('queues')
  })

  it('does not warn on the default (implicit outbox) when no database is connected', async () => {
    const records: {level: string; msg: string}[] = []
    __setRootLogger(
      createLogger({level: 'trace', sink: r => records.push({level: r.level, msg: r.msg})})
    )

    await useQueues().setup()

    expect(records.some(r => r.level === 'warn')).toBe(false)
  })
})
