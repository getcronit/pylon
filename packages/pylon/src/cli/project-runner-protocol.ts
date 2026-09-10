/**
 * The stdout envelope contract between `spawnProjectRunner` (parent) and
 * `project-runner` (child). Kept in its own module (constants only) so the parent
 * can import it without pulling in the runner's top-level `main()`.
 */
export const RESULT_OPEN = ' PYLON_RUNNER_RESULT '
export const RESULT_CLOSE = ' /PYLON_RUNNER_RESULT '

export interface RunnerEnvelope<T = unknown> {
  ok: boolean
  result?: T
  /** The failure's MESSAGE only — what the user reads. */
  error?: string
  /** The child's stack, kept separate so it's shown only when asked for. */
  stack?: string
}
