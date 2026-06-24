/**
 * `pylon eval` — types for the A/B usefulness harness.
 *
 * The harness answers one question with a number instead of a vibe: does an agent do
 * better WITH the Pylon MCP than without? Same task, same model, two arms (mcp on/off),
 * scored by the same trustable `verify` verdict. (Design: dd/MCP_IR_TARGET.md §5.)
 *
 * The agent RUNNER is pluggable: the real one drives a headless Claude (Agent SDK),
 * a fake one applies a deterministic edit so the harness plumbing is testable without
 * any LLM auth.
 */

/** A declarative expectation over the post-edit app (kept JSON-serializable). */
export interface Expectation {
  /** Required final verify verdict (default: 'pass'). */
  verdict?: 'pass' | 'review' | 'fail'
  /** `[entity, field]` must exist on the harvested AppModel. */
  entityHasField?: [string, string]
  /** A migration file must have been created during the run. */
  migrationCreated?: boolean
}

/** One benchmark task: a base app + a prompt + how to score success. */
export interface Scenario {
  name: string
  /** Absolute path to the starting app (copied fresh per run). */
  base: string
  prompt: string
  /** Models entry within the app (default './src/index.ts'). */
  models?: string
  expect?: Expectation
}

/** Which capabilities an arm gives the agent. */
export interface Arm {
  name: string
  /** Attach the Pylon MCP server (describe_app/verify/...). */
  mcp: boolean
}

/** What the harness hands a runner for one task attempt. */
export interface RunContext {
  cwd: string
  prompt: string
  arm: Arm
  /** Absolute path to the built pylon CLI (for the MCP server config). */
  cliPath: string
  /** Env with PATH pointing at a `pylon` shim, so the agent can run the CLI. */
  env: NodeJS.ProcessEnv
}

/** What a runner reports back (LLM-agnostic). */
export interface RunResult {
  turns: number
  toolCalls: string[]
  error?: string
}

/** Pluggable agent driver. */
export interface AgentRunner {
  run(ctx: RunContext): Promise<RunResult>
}

/** Scoring outcome for one arm of one scenario. */
export interface Score {
  success: boolean
  verdict: 'pass' | 'review' | 'fail' | 'error'
  expectations: Array<{name: string; ok: boolean; detail: string}>
  migrationsAdded: number
}

/** One row of the report: a scenario × arm. */
export interface EvalRow {
  scenario: string
  arm: string
  score: Score
  turns: number
  toolCalls: number
  durationMs: number
  error?: string
}

export interface EvalReport {
  rows: EvalRow[]
}
