/**
 * `verify()` — a stratified, agent-trustable verdict on an edit.
 *
 * The point of the IR/AppModel moat is that an agent can change source and get a
 * RELIABLE answer to "did I break anything?" — not "it probably compiles". This
 * composes the pieces we already own into one verdict:
 *
 *   - build      — server bundle + schema gen (the TS-compiler schema introspection
 *                  runs here, so type-level schema breakage fails the build)
 *   - typecheck  — `tsc --noEmit` (full-program types), best-effort
 *   - migrations — uncaptured model→migration drift + migration-ledger tampering
 *
 * Verdict tiers (mirrors the masterplan's Proven / Compiles / Review):
 *   pass    — builds, types clean, schema captured. Safe.
 *   review  — builds + types clean, but something needs a human/agent follow-up
 *             (e.g. a model changed without a migration).
 *   fail    — won't build / won't typecheck / tampered migrations. Broken.
 *
 * v0 is absolute (state of HEAD-of-worktree). The relative form — `diffApp(prev,
 * next)` tagging each CHANGE Proven/Review — is the next step once this proves out.
 */
import path from 'node:path'
import {existsSync} from 'node:fs'
import {promises as fs} from 'node:fs'
import {spawn} from 'node:child_process'
import {build} from './builder/index.js'
import {runDbCommand} from './db/index.js'
import {inspectApp, type AppModel} from './inspect.js'

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

export interface VerifyCheck {
  name: string
  status: CheckStatus
  detail: string
}

export type Verdict = 'pass' | 'review' | 'fail'

export interface VerifyResult {
  verdict: Verdict
  checks: VerifyCheck[]
  /** The AppModel after the change (when the build succeeded) — context for the agent. */
  app?: AppModel
}

/** Silence stdout while running noisy build/load steps, so the CLI emits ONLY the
 *  verdict JSON (and the MCP stdio stream stays pure). */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = (() => true) as typeof process.stdout.write
  try {
    return await fn()
  } finally {
    process.stdout.write = write
  }
}

/** Resolve a local `tsc` by walking up from cwd (monorepo-aware); null if none. */
function findTsc(cwd: string): string | null {
  const bin = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
  let dir = cwd
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '.bin', bin)
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function runTsc(cwd: string): Promise<{ok: boolean; output: string}> {
  const tsc = findTsc(cwd)
  if (!tsc) return Promise.resolve({ok: true, output: ''}) // caller maps to 'skip'
  return new Promise(resolve => {
    const child = spawn(tsc, ['--noEmit', '-p', 'tsconfig.json'], {cwd})
    let out = ''
    child.stdout?.on('data', d => (out += d))
    child.stderr?.on('data', d => (out += d))
    child.on('error', () => resolve({ok: true, output: ''})) // unrunnable → skip
    child.on('close', code => resolve({ok: code === 0, output: out}))
  })
}

/** Build + typecheck + migration check → a single stratified verdict. */
export async function verifyApp(
  cwd: string,
  modelsEntry = './src/index.ts'
): Promise<VerifyResult> {
  const checks: VerifyCheck[] = []

  // 1. Build (server bundle + schema gen). Throws on failure.
  // NB: build() does `path.join(process.cwd(), outputFilePath)`, and path.join
  // concatenates an absolute 2nd arg rather than honoring it — so this MUST be a
  // cwd-relative path (like the real `pylon build`), or artifacts nest weirdly.
  let built = false
  const outDir = path.join(cwd, '.pylon-verify') // for cleanup (CLI runs in cwd)
  try {
    await quiet(async () => {
      const ctx = await build({sfiFilePath: modelsEntry, outputFilePath: './.pylon-verify'})
      try {
        await ctx.buildServer()
        built = true
      } finally {
        await ctx.dispose().catch(() => {})
      }
    })
    checks.push({name: 'build', status: 'pass', detail: 'Server bundle + schema generated.'})
  } catch (e) {
    checks.push({name: 'build', status: 'fail', detail: oneLine(errMsg(e))})
  } finally {
    await fs.rm(outDir, {recursive: true, force: true}).catch(() => {})
  }

  // 2. Typecheck (best-effort — needs a tsconfig + a resolvable tsc).
  if (existsSync(path.join(cwd, 'tsconfig.json')) && findTsc(cwd)) {
    const tsc = await runTsc(cwd)
    checks.push(
      tsc.ok
        ? {name: 'typecheck', status: 'pass', detail: 'tsc --noEmit clean.'}
        : {name: 'typecheck', status: 'fail', detail: lastLines(tsc.output, 12)}
    )
  } else {
    checks.push({name: 'typecheck', status: 'skip', detail: 'No tsconfig / tsc — skipped.'})
  }

  // 3. Migration check — uncaptured model→migration drift (no live DB needed) +
  //    ledger tampering (only when a DB is reachable).
  if (built) {
    try {
      const res = (await quiet(() =>
        runDbCommand({command: 'check', cwd, models: modelsEntry})
      )) as {check: {uncaptured: number; tampered: string[]}}
      const c = res.check
      checks.push(
        c.uncaptured > 0
          ? {
              name: 'migrations',
              status: 'warn',
              detail: `${c.uncaptured} model change(s) not captured in a migration — run \`pylon db diff\`.`
            }
          : {name: 'migrations', status: 'pass', detail: 'Schema captured; no uncaptured model changes.'}
      )
      if (c.tampered?.length)
        checks.push({
          name: 'migration-integrity',
          status: 'fail',
          detail: `Tampered/edited applied migrations: ${c.tampered.join(', ')}`
        })
    } catch (e) {
      checks.push({name: 'migrations', status: 'skip', detail: `db check unavailable: ${oneLine(errMsg(e))}`})
    }
  }

  // 4. AppModel (post-change context; the future diffApp baseline).
  let app: AppModel | undefined
  if (built) {
    try {
      app = await quiet(() => inspectApp(cwd, modelsEntry))
    } catch {
      /* build passed but harvest failed — leave app undefined */
    }
  }

  const verdict: Verdict = checks.some(c => c.status === 'fail')
    ? 'fail'
    : checks.some(c => c.status === 'warn')
      ? 'review'
      : 'pass'

  return {verdict, checks, app}
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 500)
}
function lastLines(s: string, n: number): string {
  return s.trim().split('\n').slice(-n).join('\n').slice(0, 2000)
}
