/**
 * Harness plumbing test — no LLM. A fake runner performs a deterministic edit so we can
 * assert the harness copies the app, runs the agent, scores via `verify`/`inspect`, and
 * aggregates A/B correctly. The `with-mcp` arm also captures a migration (→ pass); the
 * `baseline` arm skips it (→ review) — exercising the success/fail discrimination.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, describe, expect, it} from 'vitest'
import {runEval, type AgentRunner, type RunContext, type RunResult} from '@/cli/eval/index.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../../..')
const cliPath = path.join(repoRoot, 'packages/pylon-dev/dist/index.js')
const base = path.join(repoRoot, 'e2e/fixtures/mcp-demo-app')
const runsDir = path.join(repoRoot, 'e2e/fixtures/.eval-runs')

const TAG_MODEL = `
export class Tag extends models.Model {
  static objects = db.manager(Tag)
  id = models.ID()
  label = models.Text()
}
// A declaration (not a bare expression statement, which prepareModelSource strips as a
// serve() call) so the model-loading bridge keeps + runs the registration.
export const __tagApp = new Pylon({db: {models: [Tag]}})
`

/** Edits in every arm; only migrates when the MCP arm is active. */
const fakeRunner: AgentRunner = {
  async run(ctx: RunContext): Promise<RunResult> {
    const entry = path.join(ctx.cwd, 'src/index.ts')
    const src = readFileSync(entry, 'utf8')
    // Append the new model + its registration at EOF — registration is a side effect,
    // so order doesn't matter, and appending needs no fragile `export default` anchor.
    writeFileSync(entry, `${src}\n${TAG_MODEL}`)
    const toolCalls = ['Edit']
    if (ctx.arm.mcp) {
      // Run via the `pylon` shim the harness put on PATH (proves CLI-in-workdir works).
      spawnSync('pylon', ['db', 'diff', 'add-tag'], {cwd: ctx.cwd, env: ctx.env, encoding: 'utf8'})
      toolCalls.push('Bash')
    }
    return {turns: 2, toolCalls}
  }
}

/** Build a one-scenario bench dir (a subfolder holding scenario.json). */
function makeBench(): string {
  const benchDir = mkdtempSync(path.join(os.tmpdir(), 'pylon-bench-'))
  const sub = path.join(benchDir, 'add-tag')
  mkdirSync(sub, {recursive: true})
  writeFileSync(
    path.join(sub, 'scenario.json'),
    JSON.stringify({
      name: 'add-tag',
      base,
      expect: {verdict: 'pass', entityHasField: ['Tag', 'label'], migrationCreated: true}
    })
  )
  return benchDir
}

afterAll(() => rmSync(runsDir, {recursive: true, force: true}))

describe('pylon eval harness', () => {
  if (!existsSync(cliPath)) throw new Error(`pylon CLI not built at ${cliPath}.`)

  it('scores the MCP arm pass and the baseline review (A/B discrimination)', async () => {
    const benchDir = makeBench()
    const report = await runEval({benchDir, cliPath, runner: fakeRunner})
    rmSync(benchDir, {recursive: true, force: true})

    const mcp = report.rows.find(r => r.arm === 'with-mcp')!
    const baseline = report.rows.find(r => r.arm === 'baseline')!

    expect(mcp.score.verdict).toBe('pass')
    expect(mcp.score.success).toBe(true)
    expect(mcp.score.migrationsAdded).toBeGreaterThan(0)

    expect(baseline.score.verdict).toBe('review')
    expect(baseline.score.success).toBe(false)
    expect(baseline.score.migrationsAdded).toBe(0)
  }, 180_000)
})
