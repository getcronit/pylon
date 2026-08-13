/**
 * `pylon mcp` — the Model Context Protocol server (stdio) over the AppModel.
 *
 * This is the surface an agent talks to: instead of grepping a codebase, it asks
 * `describe_app` for the whole-app model, drills in with `get_entity`/`get_operation`,
 * and — the payoff — calls `verify` after an edit for a trustable pass/review/fail.
 *
 * Handlers SPAWN the CLI subcommands (`pylon inspect --json`, `pylon verify --json`)
 * rather than calling in-process: the build/load steps log, and stdout here is the
 * MCP protocol stream — a stray write would corrupt it. The child's stdout is
 * captured; its stderr/logs stay out of the way.
 */
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import {version} from '../package.json'

/** Post-bundle this file IS dist/index.js — so it's also the CLI we re-invoke. */
const CLI = fileURLToPath(import.meta.url)

function runCli(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    let out = ''
    let err = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (err += d))
    child.on('error', reject)
    child.on('close', code =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `pylon ${args[0]} exited ${code}`))
    )
  })
}

const TOOLS = [
  {
    name: 'describe_app',
    description:
      'The whole-app model in one structured artifact: GraphQL schema + persistence ' +
      'entities (columns/relations/indexes) + operations + per-model authz + queues. ' +
      'Read this first to understand the app instead of opening many files.',
    inputSchema: {type: 'object', properties: {}}
  },
  {
    name: 'get_entity',
    description:
      'One persisted entity — its columns, relations and indexes — plus its authz ' +
      'shape and the operations that reference it.',
    inputSchema: {
      type: 'object',
      properties: {name: {type: 'string', description: 'Entity name, e.g. "Post"'}},
      required: ['name']
    }
  },
  {
    name: 'get_operation',
    description: 'One GraphQL operation: its root (Query/Mutation), arguments and return type.',
    inputSchema: {
      type: 'object',
      properties: {name: {type: 'string', description: 'Operation name, e.g. "posts"'}},
      required: ['name']
    }
  },
  {
    name: 'verify',
    description:
      'Build + typecheck + migration check → a stratified verdict (pass / review / fail). ' +
      'Call this AFTER editing source to know whether the change is safe: "review" flags ' +
      'follow-ups like an uncaptured migration; "fail" means it will not build or typecheck.',
    inputSchema: {type: 'object', properties: {}}
  }
]

export async function startMcpServer(cwd: string, modelsEntry: string): Promise<void> {
  const server = new Server({name: 'pylon', version}, {capabilities: {tools: {}}})
  const m = ['-m', modelsEntry]

  server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: TOOLS}))

  server.setRequestHandler(CallToolRequestSchema, async req => {
    const {name} = req.params
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    try {
      if (name === 'describe_app') return text(await runCli(cwd, ['inspect', '--json', ...m]))
      if (name === 'verify') return text(await runCli(cwd, ['verify', '--json', ...m]))

      if (name === 'get_entity') {
        const model = JSON.parse(await runCli(cwd, ['inspect', '--json', ...m]))
        const en = String(args.name ?? '')
        const entity = model.schema.entities[en]
        if (!entity)
          return fail(`No entity "${en}". Known: ${Object.keys(model.schema.entities).join(', ')}`)
        // Loose reference match: an operation whose args/return mention the entity.
        const operations = model.schema.operations.filter((o: unknown) =>
          JSON.stringify(o).includes(en)
        )
        const authz = model.authz.find((a: {model: string}) => a.model === en)
        return text(JSON.stringify({entity, authz, operations}, null, 2))
      }

      if (name === 'get_operation') {
        const model = JSON.parse(await runCli(cwd, ['inspect', '--json', ...m]))
        const on = String(args.name ?? '')
        const op = model.schema.operations.find((o: {name: string}) => o.name === on)
        if (!op) return fail(`No operation "${on}".`)
        return text(JSON.stringify(op, null, 2))
      }

      return fail(`Unknown tool "${name}".`)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  await server.connect(new StdioServerTransport())
}

function text(s: string) {
  return {content: [{type: 'text' as const, text: s}]}
}
function fail(message: string) {
  return {content: [{type: 'text' as const, text: message}], isError: true}
}
