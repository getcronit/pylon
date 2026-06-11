/**
 * `pylon worker` end-to-end: bundle a worker entry with esbuild and run it.
 * Uses the actual built CLI (`dist/index.js`) so the command wiring, bundling
 * and child-process spawn are all exercised — no Redis needed (the trivial entry
 * just prints a marker and exits).
 */
import {spawn} from 'node:child_process'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cli = path.resolve(dir, '..', 'dist', 'index.js')

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

  it('bundles the worker entry and runs it', async () => {
    await fs.writeFile(
      path.join(cwd, 'src', 'worker.ts'),
      `const marker: string = 'WORKER_OK'\nconsole.log(marker)\nprocess.exit(0)\n`
    )
    const {code, stdout} = await run(
      ['worker', '-e', './src/worker.ts', '-o', './.pylon/worker.js', '-c', 'node .pylon/worker.js'],
      cwd
    )
    expect(stdout).toMatch(/WORKER_OK/)
    expect(code).toBe(0)
    // the bundle was emitted
    await expect(fs.access(path.join(cwd, '.pylon', 'worker.js'))).resolves.toBeUndefined()
  })
})
