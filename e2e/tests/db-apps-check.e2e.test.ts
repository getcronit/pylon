/**
 * Regression: `pylon db check` / `plan` in APPS mode.
 *
 * In apps mode each app owns its migrations, colocated with its source — the
 * root `./migrations` directory is typically absent. `status`, `diff`, `migrate`
 * and `deploy` all branch on that; `check` and `plan` did not. They built a
 * runner over the (empty) root directory and diffed it against EVERY model in
 * the project, so `check` reported the entire schema as uncaptured — a real
 * ~80-model app saw "345 uncaptured model change(s)" while `status` reported
 * zero — and `plan` printed "No migrations." for a project full of them.
 *
 * The fixture has three apps with migrations under `src/apps/*` and no root
 * migrations dir, so it reproduces that shape exactly. No database needed:
 * `check`/`plan` work offline (they only skip the ledger/drift half).
 */
import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cliBin = path.resolve(dir, '../../packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/apps-app')

function pylonDb(...args: string[]) {
  const r = spawnSync('node', [cliBin, 'db', ...args], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: '',
      PYLON_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
      CONSOLA_LEVEL: '5'
    }
  })
  return {status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`}
}

describe('pylon db in apps mode (no root migrations dir)', () => {
  beforeAll(() => {
    if (!existsSync(cliBin)) {
      throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
    }
  })

  it('check scopes to each app rather than the empty root dir', () => {
    const r = pylonDb('check')
    expect(r.out).not.toMatch(/uncaptured model change/)
    expect(r.status, r.out).toBe(0)
  })

  it('check agrees with status', () => {
    const status = pylonDb('status')
    expect(status.status, status.out).toBe(0)
    // Every app reports zero uncaptured, so `check` must pass too.
    expect(status.out).toMatch(/app \w+: 0 uncaptured change\(s\)/)
    expect(pylonDb('check').status).toBe(0)
  })

  it('plan finds each app’s migrations instead of the empty root', () => {
    const r = pylonDb('plan')
    expect(r.status, r.out).toBe(0)
    expect(r.out).not.toMatch(/No migrations\./)
    // Statements are labelled "<app>:<migration>" and include real DDL.
    expect(r.out).toMatch(/blog:.*_init/)
    expect(r.out).toMatch(/CREATE TABLE/)
  })
})

/**
 * Regression: an expected failure (no DATABASE_URL, an unknown app, a refused
 * migration) used to print the child's stack THROUGH the parent's — two traces of
 * the user's own node_modules for a one-line problem. Only `--verbose` shows them.
 */
describe('pylon db error reporting', () => {
  it('prints an expected failure as one line, not a stack', () => {
    const r = pylonDb('migrate') // no DATABASE_URL in this env
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/requires DATABASE_URL to be set/)
    expect(r.out).not.toMatch(/at .*project-runner/)
    expect(r.out).toMatch(/--verbose for the stack trace/)
  })

  it('--verbose brings the stack back', () => {
    const r = pylonDb('migrate', '--verbose')
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/at .*runDbCommandCore/)
  })
})

/**
 * Regression: `pylon db diff` in apps mode covered ONE app per invocation and
 * refused without `--app`, so capturing "I changed some models" meant re-running
 * it once per app to discover which had drifted. It now defaults to every app.
 */
describe('pylon db diff across all apps', () => {
  it('needs no --app and reports every app', () => {
    const r = pylonDb('diff')
    expect(r.status, r.out).toBe(0)
    expect(r.out).not.toMatch(/specify one/)
    // Fixture is in sync, so the answer is "nothing", stated once for the project.
    expect(r.out).toMatch(/No schema changes in any app/)
  })

  it('names the apps when --app is wrong, without demanding one otherwise', () => {
    const r = pylonDb('diff', '--app', 'nope')
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/Unknown app "nope"/)
    expect(r.out).toMatch(/blog/)
  })
})
