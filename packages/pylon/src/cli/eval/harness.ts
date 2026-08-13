/**
 * The harness: orchestrate copy → run → score → aggregate. Agent-agnostic — give it
 * any `AgentRunner` (real SDK, or a fake for testing the plumbing).
 *
 * Workdirs live under `<repo>/.eval-runs/` (gitignored) so the copied app resolves the
 * workspace's `@getcronit/*` deps by walk-up, exactly like the e2e fixtures do. A
 * `pylon` shim is put on PATH so the agent can run the CLI in any arm.
 */
import {promises as fs, existsSync, readdirSync, readFileSync, mkdtempSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {scoreWorkdir, migrationCount} from './score.js'
import type {AgentRunner, Arm, EvalReport, EvalRow, RunResult, Scenario} from './types.js'

const DEFAULT_ARMS: Arm[] = [
  {name: 'with-mcp', mcp: true},
  {name: 'baseline', mcp: false}
]

/** Load scenarios from a bench dir (each subfolder with a `scenario.json`). */
export function loadScenarios(benchDir: string): Scenario[] {
  if (!existsSync(benchDir)) throw new Error(`Bench dir not found: ${benchDir}`)
  const out: Scenario[] = []
  for (const entry of readdirSync(benchDir, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue
    const file = path.join(benchDir, entry.name, 'scenario.json')
    if (!existsSync(file)) continue
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    out.push({
      name: raw.name ?? entry.name,
      base: path.resolve(path.dirname(file), raw.base),
      prompt: raw.prompt,
      models: raw.models ?? './src/index.ts',
      expect: raw.expect
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Copy an app, skipping build artifacts and deps (resolved by walk-up instead). */
async function copyApp(src: string, dest: string): Promise<void> {
  const skip = new Set(['node_modules', '.pylon', '.pylon-verify', 'dist', '.git'])
  await fs.cp(src, dest, {
    recursive: true,
    filter: s => !skip.has(path.basename(s))
  })
}

/** Write a `pylon` shim into a temp bin dir and return the dir (to prepend to PATH). */
async function prepareBin(cliPath: string): Promise<string> {
  const binDir = mkdtempSync(path.join(os.tmpdir(), 'pylon-eval-bin-'))
  const shim = path.join(binDir, 'pylon')
  await fs.writeFile(shim, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} "$@"\n`)
  await fs.chmod(shim, 0o755)
  return binDir
}

export interface RunEvalOptions {
  benchDir: string
  cliPath: string
  runner: AgentRunner
  arms?: Arm[]
  /** Keep workdirs after the run (for debugging). Default: remove. */
  keep?: boolean
  onProgress?: (msg: string) => void
}

export async function runEval(opts: RunEvalOptions): Promise<EvalReport> {
  const arms = opts.arms ?? DEFAULT_ARMS
  const scenarios = loadScenarios(opts.benchDir)
  const log = opts.onProgress ?? (() => {})
  const binDir = await prepareBin(opts.cliPath)
  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    PYLON_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1'
  }

  const rows: EvalRow[] = []
  const runsDirs = new Set<string>()
  let n = 0
  for (const scenario of scenarios) {
    // Place workdirs BESIDE the base app (in `<base-parent>/.eval-runs/`) so the copy
    // resolves the same node_modules the base does — workspace deps included.
    const runsDir = path.join(path.dirname(scenario.base), '.eval-runs')
    runsDirs.add(runsDir)
    await fs.mkdir(runsDir, {recursive: true})
    for (const arm of arms) {
      const workdir = path.join(runsDir, `${scenario.name}__${arm.name}__${n++}`)
      await fs.rm(workdir, {recursive: true, force: true})
      await copyApp(scenario.base, workdir)
      const baseline = migrationCount(workdir)
      const models = scenario.models ?? './src/index.ts'

      log(`▶ ${scenario.name} / ${arm.name}`)
      const started = Date.now()
      // A runner that throws (e.g. the Agent SDK isn't installed) shouldn't abort the
      // whole bench — record it as a failed row and keep going.
      let result: RunResult
      try {
        result = await opts.runner.run({
          cwd: workdir,
          prompt: scenario.prompt,
          arm,
          cliPath: opts.cliPath,
          env
        })
      } catch (e) {
        result = {turns: 0, toolCalls: [], error: (e as Error).message}
      }
      const durationMs = Date.now() - started

      const score = scoreWorkdir(opts.cliPath, workdir, models, scenario.expect, baseline)
      const mcpCalls = result.toolCalls.filter(t => t.startsWith('mcp__pylon')).length
      rows.push({
        scenario: scenario.name,
        arm: arm.name,
        score,
        turns: result.turns,
        toolCalls: result.toolCalls.length,
        mcpCalls,
        tools: result.toolCalls,
        durationMs,
        error: result.error
      })
      log(
        `  ${score.success ? '✓ success' : '✗ fail'} · verdict=${score.verdict} · ` +
          `turns=${result.turns} · tools=${result.toolCalls.length} · mcp=${mcpCalls}` +
          (result.error ? ` · runner-error: ${result.error}` : '')
      )
      if (!opts.keep) await fs.rm(workdir, {recursive: true, force: true})
    }
  }

  await fs.rm(binDir, {recursive: true, force: true})
  if (!opts.keep) for (const d of runsDirs) await fs.rm(d, {recursive: true, force: true})
  return {rows}
}

/** Render a compact comparison table grouped by scenario. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = []
  const byScenario = new Map<string, EvalRow[]>()
  for (const r of report.rows) {
    const list = byScenario.get(r.scenario) ?? []
    list.push(r)
    byScenario.set(r.scenario, list)
  }
  for (const [scenario, rs] of byScenario) {
    lines.push(`\n${scenario}`)
    lines.push(`  ${'arm'.padEnd(12)} ${'result'.padEnd(8)} ${'verdict'.padEnd(8)} ${'turns'.padEnd(6)} ${'tools'.padEnd(6)} mcp`)
    for (const r of rs) {
      lines.push(
        `  ${r.arm.padEnd(12)} ${(r.score.success ? 'PASS' : 'FAIL').padEnd(8)} ` +
          `${r.score.verdict.padEnd(8)} ${String(r.turns).padEnd(6)} ${String(r.toolCalls).padEnd(6)} ${r.mcpCalls}`
      )
    }
  }
  // Headline: success rate + avg turns + whether the MCP was actually used.
  const arms = [...new Set(report.rows.map(r => r.arm))]
  lines.push('\nsummary')
  for (const arm of arms) {
    const rs = report.rows.filter(r => r.arm === arm)
    const wins = rs.filter(r => r.score.success).length
    const avgTurns = rs.length ? (rs.reduce((s, r) => s + r.turns, 0) / rs.length).toFixed(1) : '0'
    const mcp = rs.reduce((s, r) => s + r.mcpCalls, 0)
    lines.push(`  ${arm.padEnd(12)} success ${wins}/${rs.length} · avg turns ${avgTurns} · mcp-calls ${mcp}`)
  }
  return lines.join('\n')
}
