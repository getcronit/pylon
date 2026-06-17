/**
 * Unit coverage for the Tier-0 live-reload SSE server: it binds at the requested
 * port, steps up to the next free port when one is taken, and pushes a `reload`
 * event to connected clients. (The full dev edit→push→reload path is exercised by
 * dev-pages-loop.)
 */
import http from 'node:http'
import {afterEach, describe, expect, it} from 'vitest'
import {
  startDevReloadServer,
  type DevReloadServer
} from '../../packages/pylon-dev/src/builder/dev-reload-server'

const open: DevReloadServer[] = []
const extra: http.Server[] = []

afterEach(async () => {
  await Promise.all(open.splice(0).map(s => s.close().catch(() => {})))
  for (const s of extra.splice(0)) s.close()
})

function track(s: DevReloadServer) {
  open.push(s)
  return s
}

describe('dev live-reload SSE server', () => {
  it('binds at the requested port, then steps up when it is taken', async () => {
    const base = 4783
    const a = track(await startDevReloadServer(base))
    expect(a.port).toBe(base)

    // Second server asks for the same base — it must NOT collide.
    const b = track(await startDevReloadServer(base))
    expect(b.port).toBeGreaterThan(a.port)
  })

  it('pushes a `reload` event to a connected client on notify()', async () => {
    const server = track(await startDevReloadServer(4790))

    const got = new Promise<string>((resolve, reject) => {
      const req = http.get(
        {host: '127.0.0.1', port: server.port, path: '/__pylon_reload'},
        res => {
          let buf = ''
          res.on('data', (c: Buffer) => {
            buf += c.toString()
            if (buf.includes('event: reload')) resolve(buf)
          })
        }
      )
      req.on('error', reject)
      setTimeout(() => reject(new Error('timed out waiting for reload event')), 5000)
    })

    // Let the connection register before pushing.
    await new Promise(r => setTimeout(r, 200))
    server.notify()

    expect(await got).toContain('event: reload')
  })

  it('serves CORS + 404s unknown paths', async () => {
    const server = track(await startDevReloadServer(4795))
    const res = await fetch(`http://127.0.0.1:${server.port}/nope`)
    expect(res.status).toBe(404)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
