/**
 * Robustness e2e: a `pylon.config` that throws at load must FAIL THE BUILD LOUDLY
 * (non-zero exit + a clear message) — never silently continue, which previously
 * booted the app with ZERO plugins (no db/auth/app/pages → unsecured).
 *
 * Guards the two fixes: bundler `initBuildPlugins` now throws instead of
 * `catch(log)`, and the CLI sets a non-zero `exitCode` on a thrown command.
 */
import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/badconfig-app')

describe('pylon build with a throwing pylon.config', () => {
  it('exits NON-ZERO and reports the config failure (no silent zero-plugin boot)', () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)
    const r = spawnSync('node', [cliBin, 'build'], {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    expect(r.status, `expected non-zero exit; output:\n${out}`).not.toBe(0)
    expect(out).toMatch(/pylon\.config|Failed to load|boom/i)
  })
})
