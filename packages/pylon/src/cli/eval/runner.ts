/**
 * The real agent runner: drives a headless Claude via the Claude Agent SDK.
 *
 * The SDK is an OPTIONAL dependency — imported dynamically so `pylon`'s core install
 * stays lean and the harness's plumbing (copy/score/aggregate) is usable with a fake
 * runner in tests. Running a real eval needs `@anthropic-ai/claude-agent-sdk` plus
 * Claude auth (the same the user's Claude Code uses, or ANTHROPIC_API_KEY).
 */
import type {AgentRunner, RunContext, RunResult} from './types.js'

/** Minimal shape of the SDK we depend on (typed locally; no hard dep). */
interface SdkQuery {
  (args: {prompt: string; options: Record<string, unknown>}): AsyncIterable<any>
}

async function loadSdk(): Promise<SdkQuery> {
  try {
    // Non-literal specifier: keeps the optional SDK out of tsc's module resolution
    // (it's resolved at runtime only, in projects that installed it).
    const pkg = '@anthropic-ai/claude-agent-sdk'
    const mod: any = await import(/* @vite-ignore */ pkg)
    if (typeof mod.query !== 'function') throw new Error('no `query` export')
    return mod.query as SdkQuery
  } catch (e) {
    throw new Error(
      'pylon eval needs the Claude Agent SDK. Install it in this project:\n' +
        '  pnpm add -D @anthropic-ai/claude-agent-sdk\n' +
        `(import failed: ${(e as Error).message})`
    )
  }
}

export class SdkRunner implements AgentRunner {
  constructor(private opts: {model?: string; maxTurns?: number} = {}) {}

  async run(ctx: RunContext): Promise<RunResult> {
    const query = await loadSdk()

    // Both arms get the pylon CLI on PATH (via ctx.env) so they can build/migrate like
    // any dev would; the ONLY difference is whether the MCP server is attached. That
    // isolates the value of the MCP *tools*, not of the CLI.
    const allowedTools = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep']
    const options: Record<string, unknown> = {
      cwd: ctx.cwd,
      env: ctx.env,
      permissionMode: 'acceptEdits',
      maxTurns: this.opts.maxTurns ?? 30,
      allowedTools
    }
    if (this.opts.model) options.model = this.opts.model
    if (ctx.arm.mcp) {
      options.mcpServers = {
        pylon: {command: process.execPath, args: [ctx.cliPath, 'mcp', '--cwd', ctx.cwd]}
      }
      allowedTools.push(
        'mcp__pylon__describe_app',
        'mcp__pylon__get_entity',
        'mcp__pylon__get_operation',
        'mcp__pylon__verify'
      )
    }

    let turns = 0
    const toolCalls: string[] = []
    let error: string | undefined
    try {
      for await (const msg of query({prompt: ctx.prompt, options})) {
        if (msg?.type === 'assistant') {
          turns++
          for (const block of msg.message?.content ?? [])
            if (block?.type === 'tool_use') toolCalls.push(block.name)
        } else if (msg?.type === 'result' && msg.subtype && msg.subtype !== 'success') {
          error = String(msg.subtype)
        }
      }
    } catch (e) {
      error = (e as Error).message
    }
    return {turns, toolCalls, error}
  }
}
