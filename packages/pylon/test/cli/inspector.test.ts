import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {keepInspectorOnParentOnly} from '@/cli/dev/inspector'

describe('keepInspectorOnParentOnly — hold the debugger on the dev parent process', () => {
  let savedOptions: string | undefined
  let savedArgv: string[]

  beforeEach(() => {
    savedOptions = process.env.NODE_OPTIONS
    savedArgv = process.execArgv
  })
  afterEach(() => {
    if (savedOptions === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = savedOptions
    process.execArgv = savedArgv
  })

  it('strips --inspect from NODE_OPTIONS so spawned children start clean', () => {
    process.env.NODE_OPTIONS = '--inspect --max-old-space-size=4096'
    process.execArgv = []
    keepInspectorOnParentOnly()
    // the unrelated flag survives; the inspector flag is gone
    expect(process.env.NODE_OPTIONS).toBe('--max-old-space-size=4096')
  })

  it('drops NODE_OPTIONS entirely when the inspector was its only flag', () => {
    process.env.NODE_OPTIONS = '--inspect=127.0.0.1:9229'
    process.execArgv = []
    keepInspectorOnParentOnly()
    expect(process.env.NODE_OPTIONS).toBeUndefined()
  })

  it('covers every --inspect* variant', () => {
    process.env.NODE_OPTIONS = '--inspect-brk --inspect-port=9230 --inspect-publish-uid=http'
    process.execArgv = []
    keepInspectorOnParentOnly()
    expect(process.env.NODE_OPTIONS ?? '').not.toMatch(/--inspect/)
  })

  it('strips --inspect from execArgv so worker_threads do not inherit it', () => {
    delete process.env.NODE_OPTIONS
    process.execArgv = ['--inspect=9229', '--enable-source-maps']
    keepInspectorOnParentOnly()
    expect(process.execArgv).toEqual(['--enable-source-maps'])
  })

  it('is a no-op when no inspector was requested', () => {
    process.env.NODE_OPTIONS = '--enable-source-maps'
    process.execArgv = ['--enable-source-maps']
    keepInspectorOnParentOnly()
    expect(process.env.NODE_OPTIONS).toBe('--enable-source-maps')
    expect(process.execArgv).toEqual(['--enable-source-maps'])
  })
})
