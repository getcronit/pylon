import {describe, expect, it, vi} from 'vitest'
import {devtoolsSink, prettySink} from '@/core/logger-pretty'

describe('pretty formatter', () => {
  it('renders time, level, tag, msg and fields on one line', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      prettySink({
        time: Date.parse('2020-01-01T12:34:56.789Z'),
        level: 'info',
        msg: 'served',
        tag: 'http',
        status: 200,
        path: '/x'
      })
      const line = spy.mock.calls[0][0] as string
      expect(line).toContain('12:34:56.789')
      expect(line).toContain('INFO')
      expect(line).toContain('[http]')
      expect(line).toContain('served')
      expect(line).toContain('status=200')
      expect(line).toContain('path=/x')
    } finally {
      spy.mockRestore()
    }
  })

  it('prints a normalized error stack on its own line', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      prettySink({
        time: Date.now(),
        level: 'error',
        msg: 'boom',
        err: {name: 'Error', message: 'bad', stack: 'Error: bad\n    at somewhere'}
      })
      expect(spy.mock.calls).toHaveLength(2)
      expect(spy.mock.calls[0][0]).toContain('ERROR')
      expect(spy.mock.calls[1][0]).toContain('at somewhere')
    } finally {
      spy.mockRestore()
    }
  })

  it('devtools sink writes the pretty line to the terminal (stdout), not console.log', () => {
    // Terminal half goes through process.stdout.write — NOT console.log — so an attached DevTools
    // console (which mirrors console.*) doesn't get a duplicate of the headline.
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      delete (globalThis as {__PYLON_INSPECTOR_CONSOLE__?: unknown}).__PYLON_INSPECTOR_CONSOLE__
      devtoolsSink({time: Date.now(), level: 'info', msg: 'served', tag: 'http', status: 200})
      const line = write.mock.calls[0][0] as string
      expect(line).toContain('INFO')
      expect(line).toContain('[http]')
      expect(line).toContain('served')
      expect(line).toContain('status=200')
      expect(log).not.toHaveBeenCalled() // never the mirrored channel
    } finally {
      write.mockRestore()
      log.mockRestore()
    }
  })

  it('devtools sink sends the record to inspector.console (DevTools-only) when attached', () => {
    // DevTools half: a CSS headline PLUS the full record as an arg → expandable tree in Chrome,
    // via the inspector.console handle the dev server publishes on globalThis.
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const calls: unknown[][] = []
    ;(globalThis as {__PYLON_INSPECTOR_CONSOLE__?: unknown}).__PYLON_INSPECTOR_CONSOLE__ = {
      log: (...args: unknown[]) => calls.push(args)
    }
    try {
      const rec = {time: Date.now(), level: 'info' as const, msg: 'served', tag: 'http', status: 200}
      devtoolsSink(rec)
      expect(calls).toHaveLength(1)
      const args = calls[0]
      expect(args[0]).toContain('%c') // CSS format string (DevTools colors)
      expect(args[0]).toContain('INFO')
      expect(args[0]).toContain('[http] served')
      expect(args[args.length - 1]).toBe(rec) // full record → expandable in DevTools
    } finally {
      write.mockRestore()
      delete (globalThis as {__PYLON_INSPECTOR_CONSOLE__?: unknown}).__PYLON_INSPECTOR_CONSOLE__
    }
  })
})
