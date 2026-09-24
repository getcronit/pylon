/**
 * Whole-program driver: computes function summaries to a lattice fixpoint and
 * collects each seed's accumulated selection.
 *
 * Summaries are demand-driven and memoized within a pass; seed selections
 * accumulate monotonically across passes (grafts/reads are idempotent). Each pass
 * rebuilds summaries from the previous pass's approximations; iteration stops when
 * both the summary set and the seed selections stop changing (guaranteed to
 * terminate — the selection lattice has finite height and the transfer is
 * monotone). Cleared-per-pass summaries + persistent seed selections = Jacobi
 * fixpoint that also resolves forward references and recursion.
 */
import type {GraphQLSchema} from 'graphql'
import {isFn} from './ast'
import {ModuleGraph} from './module-graph'
import {validateSeed} from './schema-validate'
import type {FileScope} from './scope'
import {INPUTS, summarize, type AnalyzeCtx, type SeedRecord} from './summary'
import type {SelectorNode, Summary} from './types'

export interface AnalyzeOptions {
  pylonPackage?: string
  tsconfig?: string
  maxPasses?: number
  /** When provided, each seed's selection is normalized against the schema:
   *  non-fields are dropped and `__isList` is set authoritatively. */
  schema?: GraphQLSchema
  /** Reuse a persistent module graph across pages (a whole build) instead of
   *  rebuilding the resolver + parse/scope caches per call. */
  graph?: ModuleGraph
}

export interface AnalyzeResult {
  seeds: Map<string, SeedRecord>
  seedSelectors: Map<string, SelectorNode>
  /** useMutation: nested return selection off `await trigger(...)`, keyed by seed. */
  nestedSelectors: Map<string, SelectorNode>
  graph: ModuleGraph
}

function fnKey(file: string, node: any): string {
  return `${file}:${node.start}-${node.end}`
}

/** Top-level function/component nodes of a file (things that can hold seeds or be
 *  called/rendered). */
function topLevelFns(scope: FileScope): {file: string; node: any}[] {
  const out: {file: string; node: any}[] = []
  const seen = new Set<any>()
  const push = (node: any) => {
    const real = node?.init && isFn(node.init) ? node.init : node
    if (!real || seen.has(real)) return
    if (!isFn(real) && real.type !== 'FunctionDeclaration') return
    seen.add(real)
    out.push({file: scope.file, node: real})
  }
  for (const b of scope.decls.values()) if (b.what === 'function') push(b.init ?? b.node)
  return out
}

function serializeSummary(s: Summary): string {
  const ir: Record<string, SelectorNode> = {}
  for (const [k, v] of s.inputReads) ir[k] = v
  return JSON.stringify({ir, args: [...s.argInputs].sort(), ret: s.ret.kind})
}
function serializeSelectors(m: Map<string, SelectorNode>): string {
  const o: Record<string, SelectorNode> = {}
  for (const k of [...m.keys()].sort()) o[k] = m.get(k)!
  return JSON.stringify(o)
}

export function analyze(
  files: {path: string; text: string}[],
  options: AnalyzeOptions = {}
): AnalyzeResult {
  const pylonPackage = options.pylonPackage ?? '@getcronit/pylon/pages'
  const maxPasses = options.maxPasses ?? 12
  const graph = options.graph ?? new ModuleGraph({tsconfig: options.tsconfig})

  // Prime the graph with the entry files' in-memory text.
  for (const f of files) graph.getFile(f.path, f.text)

  const seeds = new Map<string, SeedRecord>()
  const seedSelectors = new Map<string, SelectorNode>()
  const nestedSelectors = new Map<string, SelectorNode>()

  const computed = new Map<string, Summary>()
  const inProgress = new Set<string>()
  const nodes = new Map<string, {file: string; node: any}>()
  // Set when a summary is requested while still being computed (recursion / forward
  // ref). If a whole pass never bootstraps, the call graph is acyclic and one pass
  // already reached the fixpoint — no confirming pass needed.
  let bootstrapped = false

  const ctx: AnalyzeCtx = {
    graph,
    pylonPackage,
    seeds,
    seedSelectors,
    nestedSelectors,
    summaryOf(file: string, node: any): Summary | undefined {
      const key = fnKey(file, node)
      nodes.set(key, {file, node})
      const hit = computed.get(key)
      if (hit) return hit
      if (inProgress.has(key)) {
        bootstrapped = true
        return undefined // bootstrap (recursion / fwd ref)
      }
      inProgress.add(key)
      const scope = graph.getScope(file)
      let summary: Summary
      if (!scope) {
        summary = {fn: {file, id: fnKey(file, node)}, inputReads: new Map(), argInputs: new Set(), ret: {kind: 'none'}}
        INPUTS.set(summary, [])
      } else {
        summary = summarize(file, node, scope, ctx)
      }
      computed.set(key, summary)
      inProgress.delete(key)
      return summary
    }
  }

  // Entry fns: every top-level fn/component of the given files (pages are entry
  // points, not necessarily called in-code).
  const entryFns: {file: string; node: any}[] = []
  for (const f of files) {
    const scope = graph.getScope(f.path, f.text)
    if (scope) entryFns.push(...topLevelFns(scope))
  }

  let prevSig = ''
  for (let pass = 0; pass < maxPasses; pass++) {
    computed.clear()
    inProgress.clear()
    bootstrapped = false
    for (const {file, node} of entryFns) ctx.summaryOf(file, node)
    // also re-drive any fns discovered in earlier passes (callees in other files)
    for (const {file, node} of [...nodes.values()]) ctx.summaryOf(file, node)

    // Acyclic call graph → the first pass already reached the fixpoint.
    if (!bootstrapped) break

    let summarySig = ''
    for (const k of [...computed.keys()].sort()) summarySig += k + serializeSummary(computed.get(k)!)
    const sig = serializeSelectors(seedSelectors) + '||' + summarySig
    if (sig === prevSig) break
    prevSig = sig
  }

  // Schema-directed normalization: the schema is the authority on what is a field
  // and what is a list. Applied once, after the structural fixpoint settles.
  if (options.schema) {
    for (const [key, sel] of seedSelectors) {
      const rec = seeds.get(key)
      if (rec) validateSeed(sel, rec, options.schema)
    }
  }

  return {seeds, seedSelectors, nestedSelectors, graph}
}
