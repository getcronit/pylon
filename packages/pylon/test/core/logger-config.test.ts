import {afterEach, describe, expect, it} from 'vitest'
import {
  __setRootLogger,
  accessLogEnabled,
  configureLogger,
  createLogger,
  getRootLogger,
  parseLevelSpec,
  setAccessLog,
  type LogRecord
} from '@/core/logger'

const originalRoot = getRootLogger()

afterEach(() => {
  __setRootLogger(originalRoot)
  setAccessLog(true)
  delete process.env.LOG_LEVEL
  delete process.env.PYLON_LOG_FORMAT
})

describe('per-tag levels', () => {
  it('gates by the most-specific matching tag prefix', () => {
    const out: LogRecord[] = []
    const log = createLogger({
      level: {'*': 'info', db: 'debug', 'queue:email': 'trace'},
      sink: r => out.push(r)
    })
    log.withTag('db').debug('db query') // db=debug → emitted
    log.withTag('http').debug('http noise') // *=info → suppressed
    log.withTag('queue').trace('queue trace') // queue=* → info → suppressed
    log.withTag('queue:email').trace('email trace') // queue:email=trace → emitted
    log.info('untagged') // *=info → emitted
    expect(out.map(r => r.msg)).toEqual(['db query', 'email trace', 'untagged'])
  })

  it('reports the effective level for a tag via .level', () => {
    const log = createLogger({level: {'*': 'warn', db: 'debug'}})
    expect(log.withTag('db').level).toBe('debug')
    expect(log.withTag('http').level).toBe('warn')
    expect(log.level).toBe('warn')
  })
})

describe('parseLevelSpec', () => {
  it('parses a scalar', () => {
    expect(parseLevelSpec('debug')).toBe('debug')
    expect(parseLevelSpec('nonsense')).toBe('info')
  })
  it('parses a comma map with a default', () => {
    expect(parseLevelSpec('info,db=debug,queue:email=trace')).toEqual({
      '*': 'info',
      db: 'debug',
      'queue:email': 'trace'
    })
  })
})

describe('configureLogger', () => {
  it('false disables the access line; true/object enables it', () => {
    configureLogger(false)
    expect(accessLogEnabled()).toBe(false)
    configureLogger({level: 'info'})
    expect(accessLogEnabled()).toBe(true)
  })

  it('applies base fields and level from the object', () => {
    const out: LogRecord[] = []
    configureLogger({level: 'debug', base: {service: 'api'}, sink: r => out.push(r)})
    getRootLogger().debug('x', {k: 1})
    expect(out[0]).toMatchObject({service: 'api', level: 'debug', msg: 'x', k: 1})
  })

  it('redacts dotted paths without mutating caller data', () => {
    const out: LogRecord[] = []
    configureLogger({
      sink: r => out.push(r),
      redact: ['authorization', 'user.password']
    })
    const user = {password: 'p', name: 'n'}
    getRootLogger().info('req', {authorization: 'secret', user})
    expect(out[0]).toMatchObject({
      authorization: '[REDACTED]',
      user: {password: '[REDACTED]', name: 'n'}
    })
    expect(user.password).toBe('p') // caller object untouched
  })

  it('env LOG_LEVEL overrides config level', () => {
    const out: LogRecord[] = []
    process.env.LOG_LEVEL = 'debug'
    configureLogger({level: 'info', sink: r => out.push(r)})
    getRootLogger().debug('shown by env override')
    expect(out.map(r => r.msg)).toContain('shown by env override')
  })
})
