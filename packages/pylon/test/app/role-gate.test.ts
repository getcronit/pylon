/**
 * The run-role gate in `executeConfig` (PYLON_ROLE): a plugin whose `roles` is set and excludes
 * the current role is SKIPPED — its `setup` never runs. This is what keeps the web-only plugins
 * (usePages, useNodeServer) — and their heavy deps — out of the worker process, and vice-versa.
 * An untagged plugin runs in every role; `all` runs everything.
 */
import {afterEach, describe, expect, it} from 'vitest'
import {Pylon} from '@/app'
import {executeConfig} from '@/app/pylon-handler'
import type {Plugin, PluginRole} from '@/core'

const prevRole = process.env.PYLON_ROLE
afterEach(() => {
  if (prevRole === undefined) delete process.env.PYLON_ROLE
  else process.env.PYLON_ROLE = prevRole
})

/** Run executeConfig under `role` with three probe plugins; return which ones' setup ran. */
async function ranUnder(role: string | undefined): Promise<string[]> {
  if (role === undefined) delete process.env.PYLON_ROLE
  else process.env.PYLON_ROLE = role

  const ran: string[] = []
  const probe = (name: string, roles?: PluginRole[]): Plugin =>
    ({name, strategy: 'first', roles, setup: async () => void ran.push(name)}) as Plugin

  const app = new Pylon()
  await executeConfig(
    {plugins: [probe('web-only', ['web']), probe('worker-only', ['worker']), probe('everywhere')]},
    undefined,
    app
  )
  return ran
}

describe('executeConfig run-role gate', () => {
  it('web role (default/unset) runs web-only + untagged, skips worker-only', async () => {
    expect((await ranUnder(undefined)).sort()).toEqual(['everywhere', 'web-only'])
    expect((await ranUnder('web')).sort()).toEqual(['everywhere', 'web-only'])
  })

  it('worker role runs worker-only + untagged, skips web-only', async () => {
    expect((await ranUnder('worker')).sort()).toEqual(['everywhere', 'worker-only'])
  })

  it('all role runs every plugin regardless of tag', async () => {
    expect((await ranUnder('all')).sort()).toEqual(['everywhere', 'web-only', 'worker-only'])
  })
})
