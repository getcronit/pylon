/**
 * Scoring: after an agent finishes, did it actually succeed? We use the SAME trustable
 * signals an agent would — `pylon verify` (the verdict) + `pylon inspect` (assert the
 * change landed) — run as subprocesses so build/load noise can't pollute the JSON.
 */
import {spawnSync} from 'node:child_process'
import {readdirSync, existsSync} from 'node:fs'
import path from 'node:path'
import type {Expectation, Score} from './types.js'

function cliJson(cliPath: string, args: string[], cwd: string): any {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
  // `verify` exits 1 on a 'fail' verdict — that's data, not a crash, so parse anyway.
  try {
    return JSON.parse(r.stdout)
  } catch {
    throw new Error(`pylon ${args[0]} produced no JSON (status ${r.status}): ${(r.stderr || '').slice(0, 300)}`)
  }
}

/** Count migration files (so we can tell whether the agent captured a migration). */
export function migrationCount(cwd: string): number {
  const dir = path.join(cwd, 'migrations')
  if (!existsSync(dir)) return 0
  let n = 0
  const walk = (d: string) => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      if (e.isDirectory()) walk(path.join(d, e.name))
      else if (e.name.endsWith('.ts')) n++
    }
  }
  walk(dir)
  return n
}

/** Score one finished workdir against the scenario's expectation. */
export function scoreWorkdir(
  cliPath: string,
  cwd: string,
  models: string,
  expect: Expectation | undefined,
  baselineMigrations: number
): Score {
  const want = expect ?? {}
  const expectations: Score['expectations'] = []
  const migrationsAdded = Math.max(0, migrationCount(cwd) - baselineMigrations)

  let verdict: Score['verdict'] = 'error'
  try {
    const v = cliJson(cliPath, ['verify', '--json', '-m', models], cwd)
    verdict = v.verdict
  } catch (e) {
    return {
      success: false,
      verdict: 'error',
      expectations: [{name: 'verify', ok: false, detail: (e as Error).message}],
      migrationsAdded
    }
  }

  // Expected verdict (default: must be a clean pass).
  const wantVerdict = want.verdict ?? 'pass'
  expectations.push({
    name: `verdict=${wantVerdict}`,
    ok: verdict === wantVerdict,
    detail: `got ${verdict}`
  })

  if (want.entityHasField) {
    const [entity, field] = want.entityHasField
    let ok = false
    let detail = 'inspect failed'
    try {
      const model = cliJson(cliPath, ['inspect', '--json', '-m', models], cwd)
      const fields: Array<{name: string}> = model.schema?.entities?.[entity]?.fields ?? []
      ok = fields.some(f => f.name === field)
      detail = ok ? 'present' : `${entity} has [${fields.map(f => f.name).join(', ')}]`
    } catch (e) {
      detail = (e as Error).message
    }
    expectations.push({name: `${entity}.${field}`, ok, detail})
  }

  if (want.migrationCreated) {
    expectations.push({
      name: 'migrationCreated',
      ok: migrationsAdded > 0,
      detail: `${migrationsAdded} added`
    })
  }

  return {
    success: expectations.every(e => e.ok),
    verdict,
    expectations,
    migrationsAdded
  }
}
