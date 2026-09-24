/**
 * Sidecar emit + call-site rewrite for every seed kind.
 *
 * For a page containing `useData` / `usePaginatedData` / `useMutation` / `op.*`
 * seeds this produces the rewritten page (calls reference compiled docs imported
 * from a per-page sidecar) and the sidecar module source (the `doc` declarations).
 * The variables thunk stays inline at the call site; only the static documents
 * move to the sidecar.
 */
import path from 'path'
import type {GraphQLSchema} from 'graphql'
import {lowerMutation, lowerQuery} from '../../../../../../query/build/lower-selection'
import {validateSelection} from './schema-validate'
import type {SeedRecord} from './summary'
import type {SelectorNode} from './types'

const DOC_IMPORT = `import { doc } from '@getcronit/pylon/query';\n\n`

export const sidecarSpecifier = (pageId: string): string => `pylon-docs:${pageId}`
export const sidecarVirtualId = (pageId: string): string => `\0pylon-docs:${pageId}`

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1')
}

/** Inner `(` … `)` span of a call expression. */
function parens(source: string, call: any): {open: number; close: number} | null {
  const calleeEnd = call.callee?.end ?? call.start
  const open = source.indexOf('(', calleeEnd)
  const close = call.end - 1
  if (open < 0 || close <= open || source[close] !== ')') return null
  return {open, close}
}
const argText = (source: string, a: any) => source.slice(a.start, a.end)

/** Build the nested connection tree: path + intermediate args wrapping node reads. */
function buildConnectionTree(
  connPath: string[],
  args: Record<string, string>,
  node: SelectorNode
): SelectorNode {
  const tree: SelectorNode = {}
  let cur: SelectorNode = tree
  connPath.forEach((field, i) => {
    const n: SelectorNode = {}
    if (args[field]) n.__args = args[field]
    if (i === connPath.length - 1) Object.assign(n, node)
    cur[field] = n
    cur = n
  })
  return tree
}

export interface EmitOptions {
  schema: GraphQLSchema
  inContext?: boolean
  scalarTypes?: Record<string, string>
}

export interface EmitResult {
  code: string
  sidecarCode: string
  /** Whether any call was actually rewritten (a sidecar produced). */
  changed: boolean
  /** Per-seed lowering failures (malformed selector, unknown field, …). */
  warnings: string[]
}

const seedLabel = (rec: SeedRecord): string =>
  rec.kind === 'mutation'
    ? 'useMutation'
    : rec.kind === 'operation'
      ? `op.${rec.opType}`
      : rec.kind === 'paginated'
        ? 'usePaginatedData'
        : 'useData'

interface Plan {
  constName: string
  decl: string
  edit: {start: number; end: number; text: string}
}

/** Emit + rewrite for one page. Only seeds declared in this file are handled. */
export function emitPage(
  pageId: string,
  source: string,
  seeds: Map<string, SeedRecord>,
  seedSelectors: Map<string, SelectorNode>,
  nestedSelectors: Map<string, SelectorNode>,
  options: EmitOptions
): EmitResult | null {
  const base = sanitize(path.basename(pageId).replace(/\.[^.]+$/, ''))
  const queryRoot = options.schema.getQueryType()

  const mine = [...seeds.entries()]
    .filter(([, rec]) => rec.file === pageId)
    .map(([key, rec]) => ({key, rec}))
    .sort((a, b) => a.rec.call.start - b.rec.call.start)
  if (mine.length === 0) return null

  const plans: Plan[] = []
  const warnings: string[] = []
  const lineOf = (pos: number) => source.slice(0, pos).split('\n').length

  mine.forEach(({key, rec}, i) => {
    const constName = `__pylonDoc_${base}_${i}`
    const opName = `${base}_${i}`
    const sel = seedSelectors.get(key) ?? {}
    const common = {docFnName: 'doc', inContext: options.inContext, scalarTypes: options.scalarTypes}
    const p = parens(source, rec.call)
    if (!p) return
    const args: any[] = rec.call.arguments ?? []

    let decl: string
    let inner: string

    try {
      if (rec.kind === 'query') {
        const lowered = lowerQuery(options.schema, sel, opName, constName, common)
        decl = lowered.docDeclaration
        const orig = source.slice(p.open + 1, p.close).trim()
        inner = orig
          ? lowered.variablesThunk
            ? `${constName}, ${lowered.variablesThunk}, ${orig}`
            : `${constName}, undefined, ${orig}`
          : lowered.variablesThunk
            ? `${constName}, ${lowered.variablesThunk}`
            : constName
      } else if (rec.kind === 'operation') {
        const lowered = lowerQuery(options.schema, sel, opName, constName, {
          ...common,
          operation: rec.opType,
          fillObjectLeaves: true
        })
        decl = lowered.docDeclaration
        const cb = args[0] ? argText(source, args[0]) : 'undefined'
        inner = `${constName}, ${lowered.variablesThunk ?? 'undefined'}, ${cb}`
      } else if (rec.kind === 'mutation') {
        if (!rec.field) throw new Error('useMutation needs a field name or `m => m.field`.')
        const lowered = lowerMutation(options.schema, rec.field, opName, constName, {
          ...common,
          nested: nestedSelectors.get(key) ?? {}
        })
        decl = lowered.docDeclaration
        const rest = args.slice(1).map(a => argText(source, a)).join(', ')
        inner = rest ? `${constName}, ${rest}` : constName
      } else {
        // paginated: wrap the node reads under the connection path, validate the
        // whole tree from Query, then lower with the connection option.
        const connPath = rec.connectionPath ?? []
        if (connPath.length === 0) throw new Error('usePaginatedData needs a connection selector.')
        const tree = buildConnectionTree(connPath, rec.connectionArgs ?? {}, sel)
        if (queryRoot) validateSelection(tree, queryRoot, options.schema)
        const lowered = lowerQuery(options.schema, tree, opName, constName, {
          ...common,
          connection: {path: connPath}
        })
        decl = lowered.docDeclaration
        const rest = args.slice(1).map(a => argText(source, a)).join(', ')
        inner =
          lowered.variablesThunk && rest
            ? `${constName}, ${lowered.variablesThunk}, ${rest}`
            : lowered.variablesThunk
              ? `${constName}, ${lowered.variablesThunk}`
              : rest
                ? `${constName}, undefined, ${rest}`
                : constName
      }
    } catch (e: any) {
      // Surface the failure (malformed selector, unknown field) instead of
      // silently dropping it; leave the call untouched so the build still runs.
      warnings.push(`${pageId}:${lineOf(rec.call.start)} ${seedLabel(rec)}(): ${e?.message ?? e}`)
      return
    }

    plans.push({constName, decl: `export ${decl}`, edit: {start: p.open + 1, end: p.close, text: inner}})
  })

  const changed = plans.length > 0
  let code = source
  if (changed) {
    for (const pl of [...plans].sort((a, b) => b.edit.start - a.edit.start)) {
      code = code.slice(0, pl.edit.start) + pl.edit.text + code.slice(pl.edit.end)
    }
    code =
      `import { ${plans.map(p => p.constName).join(', ')} } from ${JSON.stringify(
        sidecarSpecifier(pageId)
      )};\n` + code
  }

  const sidecarCode = changed ? DOC_IMPORT + plans.map(p => p.decl).join('\n\n') + '\n' : ''
  return {code, sidecarCode, changed, warnings}
}
