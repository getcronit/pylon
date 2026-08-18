import {describe, expect, it, vi} from 'vitest'
import {prettySink} from '@/core/logger-pretty'

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
})
