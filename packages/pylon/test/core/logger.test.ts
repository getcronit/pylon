import {describe, expect, it} from 'vitest'
import {
  __setRootLogger,
  createLogger,
  getLogger,
  getRootLogger,
  logger,
  runWithLogger,
  type LogRecord
} from '@/core/logger'

describe('Logger core', () => {
  it('gates calls below the level, and emits a structured record', () => {
    const out: LogRecord[] = []
    const log = createLogger({level: 'info', sink: r => out.push(r)})
    log.debug('suppressed')
    log.info('kept', {a: 1})
    expect(out.map(r => r.msg)).toEqual(['kept'])
    expect(out[0]).toMatchObject({level: 'info', msg: 'kept', a: 1})
    expect(typeof out[0].time).toBe('number')
  })

  it('child merges bindings; withTag composes hierarchically', () => {
    const out: LogRecord[] = []
    const log = createLogger({sink: r => out.push(r)})
    log.child({requestId: 'r1'}).withTag('http').withTag('sub').info('x', {k: 2})
    expect(out[0]).toMatchObject({requestId: 'r1', tag: 'http:sub', msg: 'x', k: 2})
  })

  it('normalizes Error fields (which JSON.stringify would drop)', () => {
    const out: LogRecord[] = []
    createLogger({sink: r => out.push(r)}).error('boom', {err: new Error('bad')})
    expect(out[0].err).toMatchObject({name: 'Error', message: 'bad'})
    expect(typeof (out[0].err as {stack?: unknown}).stack).toBe('string')
  })

  it('getLogger(): root outside a scope, the bound logger inside runWithLogger', () => {
    const bound = createLogger({tag: 'job'})
    expect(getLogger()).toBe(getRootLogger())
    expect(runWithLogger(bound, () => getLogger())).toBe(bound)
    expect(getLogger()).toBe(getRootLogger()) // scope popped
  })

  it('tee fans records to a second sink at/above its minLevel', () => {
    const main: LogRecord[] = []
    const tee: LogRecord[] = []
    const log = createLogger({level: 'trace', sink: r => main.push(r)}).tee(r => tee.push(r), 'info')
    log.debug('dbg') // main only (below the tee's min)
    log.info('inf') // both
    log.error('err') // both
    expect(main.map(r => r.msg)).toEqual(['dbg', 'inf', 'err'])
    expect(tee.map(r => r.msg)).toEqual(['inf', 'err'])
  })

  it('logger(tag) is lazy — resolves the current scope on each call', () => {
    const out: LogRecord[] = []
    const original = getRootLogger()
    __setRootLogger(createLogger({sink: r => out.push(r), bindings: {requestId: 'r9'}}))
    try {
      const log = logger('billing') // declared OUTSIDE any scope
      log.info('root call', {x: 1}) // resolves to the (swapped) root + tag
      expect(out[0]).toMatchObject({requestId: 'r9', tag: 'billing', msg: 'root call', x: 1})
    } finally {
      __setRootLogger(original)
    }
  })
})
