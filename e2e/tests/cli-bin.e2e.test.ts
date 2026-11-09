/**
 * The shipped `pylon` bin must be executable by the SHELL, not just by `node <path>`.
 *
 * `package.json` maps `bin: {pylon: "./dist/cli/index.js"}`. On POSIX, npm and yarn
 * classic link a bin as a bare symlink and rely on its shebang; only pnpm writes a
 * `#!/bin/sh` shim that invokes node itself. The CLI entry shipped without a shebang, so
 * under pnpm everything worked — the monorepo, the e2e suite, every existing project —
 * while an npm-installed project could not run `pylon` at all:
 *
 *     $ npm run build
 *     node_modules/.bin/pylon: line 1: import: command not found
 *
 * That is the default path for `create-pylon` (its Node scaffold and Dockerfile both use
 * npm), so the scaffold's happy path was broken by it. Every other test in this suite
 * spawns `node <abs path to dist/cli/index.js>`, which bypasses the bin entirely and can
 * never catch it — hence this file.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, promises as fs, constants} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const pkgDir = path.join(repoRoot, 'packages/pylon')
const cliEntry = path.join(pkgDir, 'dist/cli/index.js')

let tmpDir: string

beforeAll(async () => {
  if (!existsSync(cliEntry)) {
    throw new Error(`pylon CLI not built at ${cliEntry}. Run \`pnpm --filter pylon-e2e test\`.`)
  }
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-bin-'))
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, {recursive: true, force: true})
})

describe('the shipped pylon bin', () => {
  it('is the file package.json points `bin` at', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8'))
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.pylon
    expect(path.resolve(pkgDir, rel)).toBe(cliEntry)
  })

  it('starts with a node shebang', async () => {
    const firstLine = (await fs.readFile(cliEntry, 'utf8')).split('\n', 1)[0]
    expect(firstLine).toBe('#!/usr/bin/env node')
  })

  it('runs when the shell executes it directly, the way an npm symlink does', async () => {
    // Reproduce npm's layout rather than copying the file: the transpile-only build
    // leaves the CLI importing siblings (`../package-*.js`), so a copy resolves against
    // the wrong directory. npm creates `node_modules/.bin/pylon` as a SYMLINK and sets
    // the exec bit on the target; Node resolves the entry's relative imports from the
    // symlink's realpath, so the real tree is what matters.
    await fs.chmod(cliEntry, 0o755) // what the package manager does at install time
    const bin = path.join(tmpDir, 'pylon')
    await fs.symlink(cliEntry, bin)
    await fs.access(bin, constants.X_OK)

    // No `node` in argv: exec the link itself, exactly as `node_modules/.bin/pylon` does.
    const res = spawnSync(bin, ['--version'], {encoding: 'utf8', timeout: 60_000})

    expect(res.error, String(res.error)).toBeUndefined()
    // Without the shebang the shell parses the ESM as sh and reports exactly this.
    expect(res.stderr).not.toContain('import: command not found')
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  }, 60_000)

  it('does not put a shebang on the library entries', async () => {
    // Only the CLI is a bin. A stray shebang in a module entry is invalid in a browser
    // bundle and meaningless to Node's ESM loader.
    for (const entry of ['dist/core/index.js', 'dist/pages/index.js', 'dist/db/index.js']) {
      const p = path.join(pkgDir, entry)
      if (!existsSync(p)) continue
      const firstLine = (await fs.readFile(p, 'utf8')).split('\n', 1)[0]
      expect(firstLine, entry).not.toMatch(/^#!/)
    }
  })
})
