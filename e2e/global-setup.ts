// Brings up the dedicated e2e Postgres once for the whole run (started clean),
// and tears it down after. DB-using tests connect to it; they don't manage the
// container themselves. No-op when Docker is unavailable (those tests skip).
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const compose = path.join(dir, 'docker-compose.yml')
const dockerAvailable = spawnSync('docker', ['--version'], {stdio: 'ignore'}).status === 0
const dc = (...args: string[]) =>
  spawnSync('docker', ['compose', '-f', compose, ...args], {stdio: 'ignore', timeout: 120_000})

export async function setup() {
  if (!dockerAvailable) return
  dc('down', '-v') // clean any leftover from an interrupted run
  const up = dc('up', '-d', '--wait')
  if (up.status !== 0) throw new Error('e2e: docker compose up failed')
}

export async function teardown() {
  if (dockerAvailable) dc('down', '-v')
}
