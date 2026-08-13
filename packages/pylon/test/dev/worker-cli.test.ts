/**
 * `pylon worker` end-to-end: run a worker entry UNBUNDLED via the loader.
 * Uses the actual built CLI (`dist/cli/index.js`) so the command wiring (default tsx
 * loader command) and child-process spawn are exercised — no Redis needed (the
 * trivial entry just prints a marker and exits).
 */
import {spawn} from 'node:child_process'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cli = path.resolve(dir, '..', '..', 'dist', 'cli', 'index.js')

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

describe('pylon worker CLI', () => {
  let cwd: string
  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-worker-'))
    await fs.mkdir(path.join(cwd, 'src'), {recursive: true})
  })
  afterEach(async () => {
    await fs.rm(cwd, {recursive: true, force: true})
  })

  it('errors clearly when the worker entry is missing', async () => {
    const {code, stderr} = await run(['worker', '-e', './src/worker.ts'], cwd)
    expect(code).toBe(1)
    expect(stderr).toMatch(/Worker entry not found/)
    expect(stderr).toMatch(/startWorkers/)
  })

  it('runs the worker entry via the loader (no bundle)', async () => {
    await fs.writeFile(
      path.join(cwd, 'src', 'worker.ts'),
      `const marker: string = 'WORKER_OK'\nconsole.log(marker)\nprocess.exit(0)\n`
    )
    // No -o/-c: the default command is `node <tsx> ./src/worker.ts` (unbundled).
    const {code, stdout} = await run(['worker', '-e', './src/worker.ts'], cwd)
    expect(stdout).toMatch(/WORKER_OK/)
    expect(code).toBe(0)
    // no bundle is emitted
    await expect(fs.access(path.join(cwd, '.pylon', 'worker.js'))).rejects.toThrow()
  })
})
