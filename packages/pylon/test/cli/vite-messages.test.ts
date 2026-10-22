/**
 * Pylon drives Vite as a library, so a Pylon app has no `vite.config.ts`. These lock the
 * contract that no diagnostic reaching an app author names one — while the technical
 * detail (ids, paths, causes) survives, since that's what makes the error debuggable.
 */
import {afterEach, describe, expect, it} from 'vitest'

import {
  isSilencedViteMessage,
  rewriteViteText,
  sanitizeViteError,
  sanitizeViteHttpErrors,
  wrapViteLogger
} from '../../src/cli/dev/vite-messages'

afterEach(() => {
  delete process.env.PYLON_DEBUG_VITE
})

describe('rewriteViteText', () => {
  it('restates the fs.allow denial without Vite config docs', () => {
    const out = rewriteViteText(
      'The request id "/etc/passwd" is outside of Vite serving allow list.\n' +
        '\nRefer to docs https://vite.dev/config/server-options.html#server-fs-allow for configurations and more details.'
    )
    expect(out).toContain('/etc/passwd')
    expect(out).not.toMatch(/vite/i)
  })

  it('restates the blocked-host message without naming vite.config.js', () => {
    const out = rewriteViteText(
      'Blocked request. This host ("example.com") is not allowed.\n' +
        'To allow this host, add "example.com" to `server.allowedHosts` in vite.config.js.'
    )
    expect(out).toContain('example.com')
    expect(out).toContain('pylon dev')
    expect(out).not.toContain('vite.config.js')
    expect(out).not.toContain('allowedHosts')
  })

  it('replaces optimizeDeps.exclude advice with a step the app owns', () => {
    const out = rewriteViteText(
      'The file does not exist at "/x/node_modules/.vite/dep.js" which is in the optimize deps directory. The dependency might be incompatible with the dep optimizer. Try adding it to `optimizeDeps.exclude`.'
    )
    expect(out).toContain('/x/node_modules/.vite/dep.js')
    expect(out).not.toContain('optimizeDeps.exclude')
    expect(out).toContain('pylon dev')
  })

  it('matches the HTML-escaped spelling Vite uses in its 403 page', () => {
    const out = rewriteViteText(
      'The request id &quot;/Users/x/.zshrc&quot; is outside of Vite serving allow list.<br/><br/>' +
        '- /Users/x/project<br/><br/>Refer to docs https://vite.dev/config/server-options.html#server-fs-allow for configurations and more details.'
    )
    expect(out).toContain('/Users/x/.zshrc')
    expect(out).toContain('/Users/x/project')
    expect(out).not.toMatch(/vite/i)
  })

  it('maps tool identity in log and plugin prefixes', () => {
    expect(rewriteViteText('[vite] connecting...')).toBe('[pylon] connecting...')
    expect(rewriteViteText('[plugin:vite:import-analysis] Failed to resolve import')).toBe(
      '[pylon:import-analysis] Failed to resolve import'
    )
  })

  it('appends the no-config note only when a config file was named', () => {
    expect(rewriteViteText('Set `css.lightningcss.errorRecovery: true` in vite.config.ts')).toContain(
      'no vite config'
    )
    expect(rewriteViteText('Failed to resolve import "./x" from "pages/page.tsx"')).not.toContain(
      'no vite config'
    )
  })

  it('leaves the cause untouched', () => {
    const msg = 'Failed to resolve import "./missing" from "pages/page.tsx". Does the file exist?'
    expect(rewriteViteText(msg)).toBe(msg)
  })

  it('passes everything through under PYLON_DEBUG_VITE', () => {
    process.env.PYLON_DEBUG_VITE = '1'
    const raw = 'Blocked request. This host ("x") is not allowed. add it in vite.config.js'
    expect(rewriteViteText(raw)).toBe(raw)
    expect(isSilencedViteMessage('optimizeDeps.esbuildOptions is deprecated')).toBe(false)
  })
})

describe('sanitizeViteError', () => {
  it('rewrites message, stack and plugin in place', () => {
    const err = Object.assign(new Error('Blocked request. This host ("h") is not allowed.'), {
      plugin: 'vite:import-analysis',
      stack: '[vite] boom\n    at x'
    })
    sanitizeViteError(err)
    expect(err.message).toContain('pylon dev')
    expect(err.plugin).toBe('pylon:import-analysis')
    expect(err.stack).toContain('[pylon] boom')
  })

  it('survives a frozen error object', () => {
    const err = Object.freeze(new Error('[vite] nope'))
    expect(() => sanitizeViteError(err)).not.toThrow()
  })
})

describe('wrapViteLogger', () => {
  it('drops silenced noise, rewrites the rest and keeps hasWarned live', () => {
    const seen: string[] = []
    const base = {
      hasWarned: false,
      info: (m: string) => seen.push(m),
      warn(m: string) {
        this.hasWarned = true
        seen.push(m)
      },
      warnOnce: (m: string) => seen.push(m),
      error: (m: string) => seen.push(m)
    }
    const logger = wrapViteLogger(base)
    logger.warn('optimizeDeps.esbuildOptions is deprecated')
    expect(seen).toEqual([])
    expect(logger.hasWarned).toBe(false)

    logger.error('[vite] Internal server error')
    expect(seen).toEqual(['[pylon] Internal server error'])

    logger.warn('something real')
    expect(logger.hasWarned).toBe(true)
  })
})

describe('sanitizeViteHttpErrors', () => {
  const makeRes = (statusCode: number, contentType: string) => {
    const headers = new Map<string, unknown>([['content-type', contentType]])
    const written: string[] = []
    const res = {
      statusCode,
      headersSent: false,
      getHeader: (n: string) => headers.get(n),
      setHeader: (n: string, v: unknown) => headers.set(n, v),
      write: (c: any) => {
        written.push(String(c))
        return true
      },
      end: (c: any) => {
        if (c != null && typeof c !== 'function') written.push(String(c))
      }
    }
    return {res, written, headers}
  }

  it('rewrites a Vite 403 body', () => {
    const {res, written} = makeRes(403, 'text/html')
    sanitizeViteHttpErrors(res)
    res.end('The request id "/x/.zshrc" is outside of Vite serving allow list.')
    expect(written[0]).toContain('/x/.zshrc')
    expect(written[0]).not.toMatch(/vite/i)
  })

  it("rewrites an error body that declares no content-type (Vite's 403 page)", () => {
    const headers = new Map<string, unknown>()
    const written: string[] = []
    const res = {
      statusCode: 403,
      headersSent: false,
      getHeader: (n: string) => headers.get(n),
      setHeader: (n: string, v: unknown) => headers.set(n, v),
      write: (c: any) => {
        written.push(String(c))
        return true
      },
      end: () => {}
    }
    sanitizeViteHttpErrors(res)
    res.write('<p>The request id &quot;/x/.zshrc&quot; is outside of Vite serving allow list.</p>')
    expect(written[0]).toContain('/x/.zshrc')
    expect(written[0]).not.toMatch(/vite/i)
  })

  it('never touches a 200 module payload', () => {
    const {res, written} = makeRes(200, 'text/javascript')
    sanitizeViteHttpErrors(res)
    const code = 'console.log("[vite] connected")'
    res.end(code)
    expect(written[0]).toBe(code)
  })

  it('keeps content-length in sync with the rewritten body', () => {
    const {res, written, headers} = makeRes(403, 'text/plain')
    headers.set('content-length', 999)
    sanitizeViteHttpErrors(res)
    res.end('Blocked request. This host ("h") is not allowed.')
    expect(headers.get('content-length')).toBe(Buffer.byteLength(written[0]))
  })
})
