/**
 * Small AST utilities over the oxc ESTree(+JSX) tree, plus `SelectorNode`
 * construction helpers. Nodes are typed loosely (`any`) — the shapes are standard
 * ESTree; we guard on `.type` strings.
 */
import type {Path, SelectorNode, Step} from './types'

export type Node = any

/** Stable key for a node from its source span. */
export function spanKey(node: Node): string {
  return `${node.start}-${node.end}`
}

/** Depth-first walk; `visit(node, parent)` is called for every AST node. */
export function walk(
  node: Node,
  visit: (n: Node, parent: Node | null) => void,
  parent: Node | null = null
): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const c of node) walk(c, visit, parent)
    return
  }
  if (typeof node.type === 'string') visit(node, parent)
  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'range' || k === 'parent') {
      continue
    }
    walk(node[k], visit, node)
  }
}

export const isFn = (n: Node): boolean =>
  n?.type === 'FunctionDeclaration' ||
  n?.type === 'FunctionExpression' ||
  n?.type === 'ArrowFunctionExpression'

/** Unwrap parentheses / TS `as` / non-null (`!`) — all erased at runtime. */
export function unwrap(n: Node): Node {
  let cur = n
  while (cur) {
    if (cur.type === 'ParenthesizedExpression') cur = cur.expression
    else if (cur.type === 'TSAsExpression') cur = cur.expression
    else if (cur.type === 'TSNonNullExpression') cur = cur.expression
    else if (cur.type === 'TSSatisfiesExpression') cur = cur.expression
    else if (cur.type === 'ChainExpression') cur = cur.expression
    else break
  }
  return cur
}

// ── SelectorNode helpers (the lowering's input contract) ──────────────────────

const META = new Set(['__args', '__isList'])

/** Deep-merge `source` into `target` in place (union of selections). */
export function deepMerge(target: SelectorNode, source: SelectorNode): void {
  for (const key of Object.keys(source)) {
    const sv = source[key] as any
    if (META.has(key)) {
      if (sv !== undefined && target[key] === undefined) target[key] = sv
      continue
    }
    const tv = target[key] as any
    if (sv === true) {
      if (tv === undefined) target[key] = true
      // object stays object (more specific wins)
    } else if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      if (tv === undefined || tv === true) target[key] = {}
      if (target[key] && typeof target[key] === 'object') {
        deepMerge(target[key] as SelectorNode, sv)
      }
    }
  }
}

/**
 * Navigate (creating intermediate objects) along `path` from `root`, applying
 * `__args`/`__isList` per step, then merge `leaf` at the destination. `leaf` is
 * either `true` (a scalar read) or a SelectorNode subtree.
 */
export function graft(
  root: SelectorNode,
  path: Path,
  leaf: SelectorNode | true
): void {
  if (path.length === 0) {
    if (leaf !== true && typeof leaf === 'object') deepMerge(root, leaf)
    return
  }
  let cur: SelectorNode = root
  for (let i = 0; i < path.length; i++) {
    const step = path[i]
    const isLast = i === path.length - 1
    let node = cur[step.key] as any
    if (node === undefined || node === true) {
      node = {}
      cur[step.key] = node
    }
    if (step.args !== undefined && (node as SelectorNode).__args === undefined) {
      ;(node as SelectorNode).__args = step.args
    }
    if (step.list) (node as SelectorNode).__isList = true

    if (isLast) {
      if (leaf === true) {
        // leaf scalar: if nothing deeper was recorded, leave as-is (object with
        // only meta). The compiler treats an object with no real fields via
        // allScalars / __typename fallback — safe.
      } else if (typeof leaf === 'object') {
        deepMerge(node as SelectorNode, leaf)
      }
    }
    cur = node as SelectorNode
  }
}

/** Record a single scalar read at `path` from `root`. */
export function recordRead(root: SelectorNode, path: Path): void {
  if (path.length === 0) return
  let cur: SelectorNode = root
  for (let i = 0; i < path.length; i++) {
    const step = path[i]
    const isLast = i === path.length - 1
    if (isLast && step.args === undefined && !step.list) {
      if (cur[step.key] === undefined) cur[step.key] = true
      else if (typeof cur[step.key] === 'object') {
        /* keep the richer object */
      }
      return
    }
    let node = cur[step.key] as any
    if (node === undefined || node === true) {
      node = {}
      cur[step.key] = node
    }
    if (step.args !== undefined && (node as SelectorNode).__args === undefined) {
      ;(node as SelectorNode).__args = step.args
    }
    if (step.list) (node as SelectorNode).__isList = true
    cur = node as SelectorNode
  }
}

/** Deep clone a SelectorNode (used when grafting a summary subtree). */
export function cloneSelector(sel: SelectorNode): SelectorNode {
  const out: SelectorNode = {}
  for (const k of Object.keys(sel)) {
    const v = sel[k] as any
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? cloneSelector(v) : v
  }
  return out
}

export function concatPath(a: Path, b: Path): Path {
  return a.concat(b)
}

export function step(key: string, args?: string, list?: boolean): Step {
  const s: Step = {key}
  if (args !== undefined) s.args = args
  if (list) s.list = true
  return s
}
