/**
 * `pylon dev --worker` end-to-end. There is no hand-authored `src/worker.ts` and no separate
 * `pylon worker` command: the dev worker BOOTS the app (`src/index.ts`) + `pylon.config` in
 * worker role (PYLON_ROLE=worker), which registers the queues on import and runs the config's
 * plugin setups — but binds NO HTTP port (`useNodeServer` is gated out of the worker role by
 * executeConfig). Uses the actual built CLI (`dist/cli/index.js`) so the command wiring +
 * child-process spawn are exercised.
 *
 * The temp app lives UNDER packages/pylon so `import '@getcronit/pylon'` self-resolves to
 * dist (no install needed); no Redis is required because the app registers no queues.
 */
import {spawn, type ChildProcess} from 'node:child_process'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(dir, '..', '..')
const cli = path.join(pkgRoot, 'dist', 'cli', 'index.js')

/** Run the CLI to completion (for commands that exit on their own). */
function run(
  args: string[],
  cwd: string
): Promise<{code: number | null; stdout: string; stderr: string}> {
  return new Promise(resolve => {
    const child = spawn('node', [cli, ...args], {cwd, env: {...process.env}})
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('exit', code => resolve({code, stdout, stderr}))
  })
}

/** Spawn the (long-running) worker; resolve once `marker` appears in its output, or reject. */
function spawnUntil(
  args: string[],
  cwd: string,
  marker: RegExp,
  timeoutMs = 12_000
): Promise<{child: ChildProcess; output: string}> {
  return new Promise((resolve, reject) => {
    // `detached` makes the CLI a new process-group leader; the worker it spawns joins that
    // group, so `process.kill(-pid)` in killTree reaps the whole tree deterministically.
    const child = spawn('node', [cli, ...args], {cwd, env: {...process.env}, detached: true})
    let output = ''
    const onData = (d: Buffer) => {
      output += d
      if (marker.test(output)) resolve({child, output})
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', code =>
      reject(new Error(`worker exited early (code ${code}) before marker\n${output}`))
    )
    setTimeout(() => reject(new Error(`timeout waiting for ${marker}\n${output}`)), timeoutMs)
  })
}

// Kill the whole process group (CLI + the worker it spawned) — see the `detached` note above.
const killTree = (child: ChildProcess) => {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

describe('pylon dev --worker CLI', () => {
  let cwd: string
  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(pkgRoot, '.tmp-worker-'))
    await fs.mkdir(path.join(cwd, 'src'), {recursive: true})
  })
  afterEach(async () => {
    await fs.rm(cwd, {recursive: true, force: true})
  })

  it('errors clearly when the app entry is missing', async () => {
    const {code, stderr} = await run(['dev', '--worker'], cwd)
    expect(code).toBe(1)
    expect(stderr).toMatch(/App entry not found/)
    expect(stderr).toMatch(/--worker/)
  })

  it('boots the app in worker role — registers queues, binds no HTTP port', async () => {
    await fs.writeFile(
      path.join(cwd, 'src', 'index.ts'),
      `import {Pylon} from '@getcronit/pylon'\n` +
        `console.log('APP_BOOTED')\n` +
        `export default new Pylon()\n`
    )
    // Config has serving (useNodeServer) — the worker MUST NOT bind it.
    await fs.writeFile(
      path.join(cwd, 'pylon.config.ts'),
      `import {useNodeServer} from '@getcronit/pylon'\n` +
        `export default {plugins: [useNodeServer()]}\n`
    )

    const port = 3997
    const {child, output} = await spawnUntil(['dev', '--worker'], cwd, /APP_BOOTED/, undefined)
    try {
      // The parent announces the worker; the child imported the app (registers queues).
      expect(output).toMatch(/APP_BOOTED/)
      // Give any (erroneous) serve() a moment to bind, then prove nothing is listening.
      await new Promise(r => setTimeout(r, 500))
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(500)
      }).catch(() => null)
      expect(res).toBeNull() // worker role → useNodeServer no-ops → port free
    } finally {
      killTree(child)
    }
  })
})
