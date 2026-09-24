/**
 * Keep the Node inspector on the `pylon dev` PARENT process only.
 *
 * When dev is launched with the inspector — `node --inspect …` or
 * `NODE_OPTIONS='--inspect' pylon dev` — the flag is inherited by every context the dev
 * server spawns: rolldown-vite's transform/optimize workers and the client + server-runner
 * Vite instances. Each re-applies the flag and races for the default port 9229, so all but
 * the first log `Starting inspector on 127.0.0.1:9229 failed: address already in use`.
 *
 * It also breaks debugging outright: whichever worker wins the port is the context Chrome
 * DevTools attaches to — a bundler worker with none of your code — so breakpoints in your
 * resolvers (which run in THIS process) never bind.
 *
 * Fix: after this process has already opened its own inspector at launch, strip the inspector
 * flags from what children inherit (`NODE_OPTIONS` for spawned processes, `process.execArgv`
 * for worker threads). Mutating them at runtime can't close the parent's already-open
 * inspector, so the parent keeps debugging on 9229 while children start clean. No-op when no
 * inspector was requested.
 */

// `--inspect`, `--inspect-brk`, `--inspect-port`, `--inspect-publish-uid`, each with an
// optional `=host:port` / `=value`, plus any surrounding whitespace so the join stays clean.
const INSPECT_FLAG = /\s*--inspect(?:-brk|-port|-publish-uid)?(?:=\S+)?/g

export function keepInspectorOnParentOnly(): void {
  const nodeOptions = process.env.NODE_OPTIONS ?? ''
  const inEnv = nodeOptions.includes('--inspect')
  const inArgv = process.execArgv.some(a => a.startsWith('--inspect'))
  if (!inEnv && !inArgv) return

  if (inEnv) {
    const stripped = nodeOptions.replace(INSPECT_FLAG, '').replace(/\s+/g, ' ').trim()
    if (stripped) process.env.NODE_OPTIONS = stripped
    else delete process.env.NODE_OPTIONS
  }
  // worker_threads clone the parent's execArgv unless the spawner overrides it.
  if (inArgv) process.execArgv = process.execArgv.filter(a => !a.startsWith('--inspect'))
}
