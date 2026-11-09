/**
 * `useNodeServer` runtime guard (Workstream D, Stage -1).
 *
 * The same built artifact + pylon.config is meant to run on Node AND on Bun / Deno /
 * workerd (which auto-serve `export default app`). The plugin must serve ONLY on genuine
 * Node — everywhere else it no-ops, or it double-binds / crashes on `node:http`.
 *
 * The positive Node-serve path (bind a port) is exercised by every serve e2e in the root
 * `e2e/` workspace; here we lock the NO-OP branches, which are exactly the runtime-agnostic
 * contract.
 */
import {afterEach, describe, expect, it} from 'vitest'
import {isNodeRuntime, useNodeServer} from '@/plugins/use-node-server'

const g = globalThis as any
const fakeApp = {fetch: () => new Response('ok')} as any

// Restore any runtime "tell" a test mutated so cases stay independent.
afterEach(() => {
  delete g.Deno
  delete (process.versions as any).bun
})

describe('isNodeRuntime', () => {
  it('is true on genuine Node (the test runtime)', () => {
    expect(isNodeRuntime()).toBe(true)
  })

  it('is false when a Deno global is present', () => {
    g.Deno = {version: {deno: '1.0.0'}}
    expect(isNodeRuntime()).toBe(false)
  })

  it('is false under Bun (process.versions.bun set)', () => {
    ;(process.versions as any).bun = '1.1.0'
    expect(isNodeRuntime()).toBe(false)
  })

  it('is false under workerd (Cloudflare-Workers user agent)', () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', {
      value: {userAgent: 'Cloudflare-Workers'},
      configurable: true
    })
    try {
      expect(isNodeRuntime()).toBe(false)
    } finally {
      if (orig) Object.defineProperty(globalThis, 'navigator', orig)
      else delete g.navigator
    }
  })
})

describe('useNodeServer setup guard', () => {
  it('no-ops on a non-Node runtime (resolves, binds nothing)', async () => {
    g.Deno = {} // simulate Deno → auto-served by the host
    const plugin = useNodeServer({port: 0})
    await expect(plugin.setup!(fakeApp)).resolves.toBeUndefined()
  })

  it('no-ops in dev (NODE_ENV=development) — pylon dev owns serving', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const plugin = useNodeServer({port: 0})
      await expect(plugin.setup!(fakeApp)).resolves.toBeUndefined()
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it('is a `last`-strategy plugin named node-server, scoped to the web role', () => {
    const plugin = useNodeServer()
    expect(plugin.name).toBe('node-server')
    expect(plugin.strategy).toBe('last')
    // Web-only: executeConfig gates it out of the worker (PYLON_ROLE=worker) so no port
    // binds there and @hono/node-server never imports in the worker process.
    expect(plugin.roles).toEqual(['web'])
  })
})
