/**
 * The summary interpreter. Interprets ONE function body once, producing:
 *   - a `Summary` (per-input selection contributions + return fact + arg inputs),
 *   - and, for any `useData()`-family seed created inside the body, the seed's
 *     accumulated selection (written into the shared seed map).
 *
 * Values in flight carry `Supply` (provenance, a reconstructed object, a union,
 * or opaque). Every recorded read routes through `recordInto(root, …)` which
 * writes to the seed map (seed root) or the function's own input summary (input
 * root) — that single routing is the whole interprocedural mechanism: a caller
 * folds a callee's summary and its reads land on whichever root actually feeds it.
 */
import {
  cloneSelector,
  graft,
  isFn,
  recordRead,
  step as mkStep,
  unwrap,
  walk
} from './ast'
import type {ModuleGraph} from './module-graph'
import type {FileScope} from './scope'
import type {
  FnRef,
  InputId,
  Path,
  Prov,
  ReturnFact,
  Root,
  SeedKind,
  SelectorNode,
  Step,
  Summary
} from './types'

const ITERATOR_METHODS = new Set([
  'map', 'filter', 'forEach', 'reduce', 'some', 'every', 'find', 'findIndex',
  'flatMap', 'flat', 'slice', 'concat', 'reverse', 'sort', 'at',
  'toReversed', 'toSorted'
])
const BUILTIN_METHODS = new Set([
  'toString', 'toLocaleString', 'valueOf', 'includes', 'indexOf', 'split',
  'replace', 'replaceAll', 'trim', 'toLowerCase', 'toUpperCase', 'startsWith',
  'endsWith', 'padStart', 'padEnd', 'charAt', 'match', 'join', 'toFixed'
])

export interface SeedRecord {
  file: string
  call: any
  kind: SeedKind
  /** binding the seed result was assigned to (`const data = useData()`). */
  bindingName?: string
  /** useMutation: the mutation field name (`useMutation('createUser')`). */
  field?: string | null
  /** op.query / op.mutation: which operation. */
  opType?: 'query' | 'mutation'
  /** usePaginatedData: connection path + intermediate call args from the selector. */
  connectionPath?: string[]
  connectionArgs?: Record<string, string>
}

export interface AnalyzeCtx {
  graph: ModuleGraph
  pylonPackage: string
  /** Demand-driven summary provider (memoized + fixpoint by the driver). Returns
   *  undefined while a summary is being bootstrapped (recursion / forward ref). */
  summaryOf: (file: string, node: any) => Summary | undefined
  seedSelectors: Map<string, SelectorNode>
  seeds: Map<string, SeedRecord>
  /** useMutation: nested relation reads off `await trigger(...)`, keyed by seed. */
  nestedSelectors: Map<string, SelectorNode>
}

// ── Supply: an in-flight value ────────────────────────────────────────────────
type Supply =
  | {k: 'prov'; prov: Prov}
  | {k: 'obj'; props: Map<string, Supply>}
  | {k: 'union'; of: Supply[]}
  // A function value (an accessor closure carried through a config object/prop).
  // Invoking it interprets `fn` with the concrete arguments, in the frame it was
  // DEFINED in (so its free vars resolve against its own module/scope).
  | {k: 'closure'; fn: any; frame: Frame}
  // A string-literal value, tracked so a computed access `row[col.accessorKey]`
  // (config-driven grids) resolves to the concrete field it names.
  | {k: 'literal'; value: string}
  | {k: 'opaque'}

const OPAQUE: Supply = {k: 'opaque'}

function fnRef(file: string, node: any): FnRef {
  return {file, id: `${node.start}-${node.end}`}
}
function seedKey(file: string, node: any): string {
  return `${file}:${node.start}-${node.end}`
}

function markLastList(path: Path): Path {
  if (path.length === 0) return path
  const out = path.map(s => ({...s}))
  out[out.length - 1].list = true
  return out
}

/** Nested (in-body) function/component declarations of a function node. */
function computeLocalFns(fnNode: any): Map<string, any> {
  const m = new Map<string, any>()
  walk(fnNode.body, (n: any) => {
    if (n.type === 'FunctionDeclaration' && n.id?.name) m.set(n.id.name, n)
    else if (
      n.type === 'VariableDeclarator' &&
      n.id?.type === 'Identifier' &&
      n.init &&
      isFn(unwrap(n.init))
    ) {
      m.set(n.id.name, unwrap(n.init))
    }
  })
  return m
}

/**
 * An interpretation frame: the file context the interpreter currently runs in.
 * Swapped when inlining a component in another file, or invoking a closure in its
 * defining scope — that's what makes cross-file closure-config correct.
 */
interface Frame {
  file: string
  scope: FileScope
  text: string
  localFns: Map<string, any>
  env: Map<string, Supply>
}

/** Summarize + seed-scan one function. Idempotent-ish; called by the driver in
 *  dependency order (and re-called during fixpoint). */
export function summarize(
  file: string,
  fnNode: any,
  fileScope: FileScope,
  ctx: AnalyzeCtx
): Summary {
  const self = fnRef(file, fnNode)
  const inputReads = new Map<string, SelectorNode>()
  const argInputs = new Set<string>()

  // The current frame's file context (mutable — swapped for cross-file inline and
  // closure invocation). Initialized to the summarized function's own file.
  let curFile = file
  let curScope = fileScope
  let curText = ctx.graph.getFile(file)!.text
  // env: local binding name -> Supply (flow-insensitive union). `let` so a frame
  // swap can replace the whole scope.
  let env = new Map<string, Supply>()
  // Bounded unrolling of (possibly recursive) closures: how deep each fn node is
  // currently on the inline stack. Matches the ts-morph analyzer's depth-2 cap.
  const inlineDepth = new Map<any, number>()
  const MAX_INLINE_DEPTH = 2

  // inputs, from params (identifier + object destructuring).
  const inputs: InputId[] = []
  const bindPattern = (pat: any, param: number, path: Path) => {
    if (!pat) return
    if (pat.type === 'Identifier') {
      const input: InputId = {fn: self, name: pat.name, param, path}
      inputs.push(input)
      env.set(pat.name, {k: 'prov', prov: {root: {kind: 'input', input}, path: []}})
    } else if (pat.type === 'AssignmentPattern') {
      bindPattern(pat.left, param, path)
    } else if (pat.type === 'ObjectPattern') {
      for (const p of pat.properties) {
        if (p.type === 'RestElement') continue
        const key = p.key?.name ?? p.key?.value
        if (key == null) continue
        bindPattern(p.value, param, path.concat(mkStep(String(key))))
      }
    } else if (pat.type === 'ArrayPattern') {
      pat.elements.forEach((el: any, i: number) => {
        if (el) bindPattern(el, param, path.concat(mkStep(String(i), undefined, true)))
      })
    }
  }
  ;(fnNode.params ?? []).forEach((p: any, i: number) => bindPattern(p, i, []))

  // Local (in-body) function/component declarations, so a callee/JSX tag defined
  // inside this function resolves (the module scope only holds top-level names).
  // `let` so a frame swap can replace it with the inlined callee's own locals.
  let localFns = computeLocalFns(fnNode)

  const ensureInputSel = (name: string): SelectorNode => {
    let s = inputReads.get(name)
    if (!s) inputReads.set(name, (s = {}))
    return s
  }

  const writeSel = (sel: SelectorNode, path: Path, leaf?: SelectorNode) => {
    if (leaf) graft(sel, path, cloneSelector(leaf))
    else recordRead(sel, path)
  }

  /** Route a recorded read/subtree onto whichever root feeds it. */
  const recordInto = (root: Root, path: Path, leaf?: SelectorNode) => {
    if (root.kind === 'seed') {
      const key = `${root.seed.fn.file}:${root.seed.call}`
      let sel = ctx.seedSelectors.get(key)
      if (!sel) ctx.seedSelectors.set(key, (sel = {}))
      writeSel(sel, path, leaf)
    } else if (root.kind === 'mutation-nested') {
      let sel = ctx.nestedSelectors.get(root.seedKey)
      if (!sel) ctx.nestedSelectors.set(root.seedKey, (sel = {}))
      writeSel(sel, path, leaf)
    } else if (root.kind === 'mutation-trigger') {
      // the trigger binding itself — reads off it aren't data fields.
    } else {
      writeSel(ensureInputSel(root.input.name), path, leaf)
    }
  }

  const provOf = (s: Supply | undefined): Prov[] => {
    if (!s) return []
    if (s.k === 'prov') return [s.prov]
    if (s.k === 'union') return s.of.flatMap(provOf)
    return []
  }

  const extend = (p: Prov, step: Step): Prov => ({root: p.root, path: p.path.concat(step)})

  // ── seed detection ──
  const pylonHookOf = (name: string): SeedKind | null => {
    const imp = curScope.imports.get(name)
    if (!imp || imp.source !== ctx.pylonPackage) return null
    if (imp.imported === 'useData') return 'query'
    if (imp.imported === 'usePaginatedData') return 'paginated'
    if (imp.imported === 'useMutation') return 'mutation'
    return null
  }
  const isOpIdentifier = (name: string): boolean => {
    const imp = curScope.imports.get(name)
    return !!imp && imp.source === ctx.pylonPackage && imp.imported === 'op'
  }

  const registerSeed = (call: any, kind: SeedKind, extra: Partial<SeedRecord> = {}): Root => {
    // Keyed by the CURRENT frame's file, so a seed created inside an inlined
    // component is attributed to that component's file (not the entry file).
    const key = seedKey(curFile, call)
    if (!ctx.seeds.has(key)) {
      ctx.seeds.set(key, {file: curFile, call, kind, ...extra})
      if (!ctx.seedSelectors.has(key)) ctx.seedSelectors.set(key, {})
    }
    const seedId = {fn: {file: curFile, id: `${call.start}-${call.end}`}, call: `${call.start}-${call.end}`, kind}
    return {kind: 'seed', seed: seedId}
  }

  /** `useMutation('createUser')` | `useMutation(m => m.createUser)` → field name. */
  const extractMutationField = (arg: any): string | null => {
    if (!arg) return null
    const a = unwrap(arg)
    if (a.type === 'Literal' && typeof a.value === 'string') return a.value
    if (isFn(a)) {
      let body = a.body
      if (body?.type === 'BlockStatement') {
        const ret = body.body.find((s: any) => s.type === 'ReturnStatement')
        body = ret?.argument
      }
      body = body && unwrap(body)
      if (body?.type === 'MemberExpression' && !body.computed) return body.property.name
    }
    return null
  }

  /** Parse `q => q.post({id}).comments` → {path, args}; terminal connection is
   *  left uncalled (its args come from usePaginatedData's pagination args). */
  const parseChainSelector = (
    arg: any
  ): {path: string[]; args: Record<string, string>} | null => {
    const a = arg && unwrap(arg)
    if (!a || !isFn(a)) return null
    let body = a.body
    if (body?.type === 'BlockStatement') {
      const ret = body.body.find((s: any) => s.type === 'ReturnStatement')
      body = ret?.argument
    }
    if (!body) return null
    const path: string[] = []
    const args: Record<string, string> = {}
    const walkChain = (expr: any): boolean => {
      const e = unwrap(expr)
      if (!e) return false
      if (e.type === 'Identifier') return true // the arrow param `q`
      if (e.type === 'MemberExpression' && !e.computed) {
        if (!walkChain(e.object)) return false
        path.push(e.property.name)
        return true
      }
      if (e.type === 'CallExpression' && e.callee?.type === 'MemberExpression') {
        if (!walkChain(e.callee.object)) return false
        const name = e.callee.property.name
        path.push(name)
        const a0 = e.arguments[0]
        if (a0) args[name] = argText(a0)
        return true
      }
      return false
    }
    if (!walkChain(body) || path.length === 0) return null
    return {path, args}
  }

  const argText = (node: any): string => curText.slice(node.start, node.end)

  // Does an argument expression reference one of our inputs? (arg threading)
  const argRefsInput = (node: any): boolean => {
    let found = false
    walk(node, n => {
      if (n.type === 'Identifier') {
        const s = env.get(n.name)
        for (const p of provOf(s)) if (p.root.kind === 'input') found = true
      }
    })
    return found
  }

  // ── expression evaluation → Supply ──
  function evaluate(nodeRaw: any): Supply {
    const node = unwrap(nodeRaw)
    if (!node) return OPAQUE
    switch (node.type) {
      case 'Identifier': {
        return env.get(node.name) ?? OPAQUE
      }
      case 'Literal': {
        return typeof node.value === 'string' ? {k: 'literal', value: node.value} : OPAQUE
      }
      case 'MemberExpression': {
        const base = evaluate(node.object)
        // computed member
        if (node.computed) {
          const prop = node.property
          if (prop.type === 'Literal' && typeof prop.value === 'string') {
            return member(base, mkStep(prop.value))
          }
          // The index may read data (`LABELS[row.kind]`) AND may resolve to a
          // literal key (`row[col.accessorKey]` where accessorKey is "name").
          const idx = evaluate(prop)
          if (idx.k === 'literal') return member(base, mkStep(idx.value))
          // numeric or dynamic index → list element
          return elementOf(base)
        }
        return member(base, mkStep(node.property.name))
      }
      case 'CallExpression':
        return evalCall(node)
      case 'NewExpression': {
        // `new Date(row.createdAt)` etc. — the constructor is opaque, but its
        // arguments must be evaluated so reads inside them are recorded.
        for (const a of node.arguments ?? []) {
          evaluate(a?.type === 'SpreadElement' ? a.argument : a)
        }
        return OPAQUE
      }
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        // A closure value. Interpret once with opaque params so closure-variable
        // reads it makes unconditionally (as a handler / effect) are captured, and
        // ALSO return it as a callable so a later invocation with concrete args
        // (an accessor config invoked deep) traces its param-based reads.
        interpretInlineFn(node, [])
        return {k: 'closure', fn: node, frame: snapshotFrame()}
      case 'AwaitExpression':
        return evaluate(node.argument)
      case 'AssignmentExpression': {
        const rhs = evaluate(node.right)
        const lhs = unwrap(node.left)
        if (lhs.type === 'Identifier') {
          const prev = env.get(lhs.name)
          env.set(lhs.name, prev ? {k: 'union', of: [prev, rhs]} : rhs)
        }
        return rhs
      }
      case 'BinaryExpression': {
        // Operands used as scalars — member reads already recorded by evaluate;
        // no escape, so do NOT over-select.
        evaluate(node.left)
        evaluate(node.right)
        return OPAQUE
      }
      case 'UnaryExpression':
        evaluate(node.argument)
        return OPAQUE
      case 'SequenceExpression': {
        let last: Supply = OPAQUE
        for (const e of node.expressions) last = evaluate(e)
        return last
      }
      case 'ConditionalExpression': {
        evaluate(node.test) // the condition often reads data (`x.type === …`)
        const a = evaluate(node.consequent)
        const b = evaluate(node.alternate)
        return {k: 'union', of: [a, b]}
      }
      case 'LogicalExpression': {
        const a = evaluate(node.left)
        const b = evaluate(node.right)
        return {k: 'union', of: [a, b]}
      }
      case 'ObjectExpression': {
        const props = new Map<string, Supply>()
        for (const p of node.properties) {
          if (p.type !== 'Property') continue
          const key = p.key?.name ?? p.key?.value
          if (key == null) continue
          props.set(String(key), evaluate(p.value))
        }
        return {k: 'obj', props}
      }
      case 'ArrayExpression': {
        const of = node.elements.filter(Boolean).map((e: any) =>
          e.type === 'SpreadElement' ? evaluate(e.argument) : evaluate(e)
        )
        return {k: 'union', of}
      }
      case 'JSXExpressionContainer':
        return node.expression?.type === 'JSXEmptyExpression'
          ? OPAQUE
          : evaluate(node.expression)
      case 'JSXElement': {
        handleJsx(node.openingElement)
        for (const child of node.children ?? []) evaluate(child)
        return OPAQUE
      }
      case 'JSXFragment': {
        for (const child of node.children ?? []) evaluate(child)
        return OPAQUE
      }
      case 'TemplateLiteral': {
        for (const e of node.expressions) evaluate(e)
        return OPAQUE
      }
      default:
        return OPAQUE
    }
  }

  /** Record a `.key` (or field-call) read off `base`, returning the result. */
  function member(base: Supply, step: Step): Supply {
    // No field/intrinsic guessing here — the schema post-pass drops any recorded
    // key that is not a real field (`length`, protocol members, etc.).
    if (base.k === 'obj') {
      const child = base.props.get(step.key)
      return child ?? OPAQUE
    }
    if (base.k === 'union') {
      return {k: 'union', of: base.of.map(b => member(b, step))}
    }
    if (base.k === 'prov') {
      const p = extend(base.prov, step)
      recordInto(p.root, p.path)
      return {k: 'prov', prov: p}
    }
    return OPAQUE
  }

  function elementOf(base: Supply): Supply {
    if (base.k === 'prov') {
      const p: Prov = {root: base.prov.root, path: markLastList(base.prov.path)}
      recordInto(p.root, p.path)
      return {k: 'prov', prov: p}
    }
    if (base.k === 'union') return {k: 'union', of: base.of.map(elementOf)}
    return base
  }

  /**
   * Graft a summary's selection subtree onto a supply. For a prov, the whole
   * subtree lands at that prov. For a reconstructed object (a whole-`props` param
   * supplied from JSX attrs, or a config object), distribute each selected key to
   * the matching member's supply — so `function C(props){ props.rows … }` folds
   * correctly, not just the destructured `function C({rows})` form.
   */
  function graftSupply(sup: Supply, sel: SelectorNode) {
    if (sup.k === 'prov') {
      recordInto(sup.prov.root, sup.prov.path, sel)
    } else if (sup.k === 'union') {
      for (const b of sup.of) graftSupply(b, sel)
    } else if (sup.k === 'obj') {
      for (const key of Object.keys(sel)) {
        if (key === '__args' || key === '__isList') continue
        const child = sup.props.get(key)
        const sub = sel[key]
        if (child && sub && typeof sub === 'object' && !Array.isArray(sub)) {
          graftSupply(child, sub as SelectorNode)
        } else if (child && sub === true) {
          graftSupply(child, {})
        }
      }
    }
  }
  /** Force allScalars-style over-select: record the supply's path as an object leaf. */
  function recordAllReads(sup: Supply) {
    for (const p of provOf(sup)) recordInto(p.root, p.path, {})
  }

  /**
   * Resolve any callee/callback/JSX-tag expression to the function it names, and
   * whether it is a CLOSURE (declared in an enclosing scope → shares this env and
   * can read the seed) or an imported function (isolated → composed via summary).
   */
  function resolveCallable(
    expr: any
  ): {node: any; local: boolean; file: string} | null {
    const e = unwrap(expr)
    if (!e) return null
    if (isFn(e)) return {node: e, local: true, file}
    if (e.type === 'Identifier') {
      const loc = localFns.get(e.name)
      if (loc) return {node: loc, local: true, file}
      const r = ctx.graph.resolveName(curScope, e.name)
      if (r.kind === 'fn') return {node: r.node, local: false, file: r.file}
    }
    // `NS.member(...)` / `<NS.Member/>` where NS is a namespace import.
    if (e.type === 'MemberExpression' && !e.computed && e.object?.type === 'Identifier') {
      const r = ctx.graph.resolveNamespaceMember(curScope, e.object.name, e.property.name)
      if (r.kind === 'fn') return {node: r.node, local: false, file: r.file}
    }
    return null
  }

  function invoke(
    c: {node: any; local: boolean; file: string},
    args: Supply[]
  ): Supply {
    // Nested closure (declared in the current fn): shares the enclosing env.
    if (c.local) return interpretInlineFn(c.node, args)
    // Component/callee receiving a closure config → inline it CONCRETELY, in its
    // own file frame (fresh env), so the config's closures resolve where invoked.
    if (args.some(containsClosure)) return interpretInFrame(c.node, args, freshFrame(c.file, c.node))
    // Pure-data callee → compose its summary (the fast path).
    return foldCall({file: c.file, node: c.node}, args)
  }

  /** Does a supply carry a function value anywhere (a closure, or one nested in a
   *  config object/array)? Triggers concrete inlining of the receiver. */
  function containsClosure(sup: Supply): boolean {
    if (sup.k === 'closure') return true
    if (sup.k === 'obj') {
      for (const v of sup.props.values()) if (containsClosure(v)) return true
      return false
    }
    if (sup.k === 'union') return sup.of.some(containsClosure)
    return false
  }

  /** Invoke a closure supply (or a union of them) with concrete args, each in its
   *  own captured defining frame (so free vars resolve against its scope). */
  function invokeClosure(sup: Supply, args: Supply[]): Supply {
    if (sup.k === 'closure') return interpretInFrame(sup.fn, args, sup.frame)
    if (sup.k === 'union') return {k: 'union', of: sup.of.map(s => invokeClosure(s, args))}
    return OPAQUE
  }

  const snapshotFrame = (): Frame => ({file: curFile, scope: curScope, text: curText, localFns, env})

  const freshFrame = (file: string, fnNode: any): Frame => {
    const scope = ctx.graph.getScope(file)
    const parsed = ctx.graph.getFile(file)
    return {
      file,
      scope: scope ?? curScope,
      text: parsed?.text ?? curText,
      localFns: computeLocalFns(fnNode),
      env: new Map()
    }
  }

  function evalCall(node: any): Supply {
    const callee = unwrap(node.callee)

    // seeds: useData() / usePaginatedData() / useMutation()
    if (callee.type === 'Identifier') {
      const kind = pylonHookOf(callee.name)
      if (kind === 'query') {
        const root = registerSeed(node, 'query')
        return {k: 'prov', prov: {root, path: []}}
      }
      if (kind === 'paginated') {
        // The selector gives the connection PATH; the RESULT reads (edges/node
        // fields) trace off the returned connection value.
        const chain = parseChainSelector(node.arguments[0])
        const root = registerSeed(node, 'paginated', {
          connectionPath: chain?.path ?? [],
          connectionArgs: chain?.args ?? {}
        })
        return {k: 'prov', prov: {root, path: []}}
      }
      if (kind === 'mutation') {
        // useMutation returns [trigger, state]. The selection is field-name based;
        // additionally, reads off `await trigger(...)` become the nested return
        // selection. Model element 0 as a trigger marker tied to this seed.
        registerSeed(node, 'mutation', {field: extractMutationField(node.arguments[0])})
        const sk = seedKey(curFile, node)
        const trigger: Supply = {k: 'prov', prov: {root: {kind: 'mutation-trigger', seedKey: sk}, path: []}}
        return {k: 'obj', props: new Map([['0', trigger]])}
      }

      // calling a mutation trigger → the awaited result; reads off it are nested.
      const bound = env.get(callee.name)
      if (bound?.k === 'prov' && bound.prov.root.kind === 'mutation-trigger') {
        for (const a of node.arguments) evaluate(a)
        return {k: 'prov', prov: {root: {kind: 'mutation-nested', seedKey: bound.prov.root.seedKey}, path: []}}
      }

      // React memoization hooks are transparent to data flow: `useMemo(() => X)` is
      // X, `useCallback(fn)` is fn. Without this a memoized config (e.g. a columns
      // array of cell accessors) collapses to opaque and its closures are lost.
      if (callee.name === 'useMemo') {
        const cb = node.arguments[0] && unwrap(node.arguments[0])
        return cb && isFn(cb) ? interpretInlineFn(cb, []) : OPAQUE
      }
      if (callee.name === 'useCallback') {
        return node.arguments[0] ? evaluate(node.arguments[0]) : OPAQUE
      }
    }

    // member call: op.query/op.mutation, iterator, builtin, field-with-args, extern
    if (callee.type === 'MemberExpression' && !callee.computed) {
      const method = callee.property.name

      // `React.useMemo(() => X)` / `React.useCallback(fn)` — same transparency as
      // the bare-identifier forms above.
      if (method === 'useMemo') {
        const cb = node.arguments[0] && unwrap(node.arguments[0])
        return cb && isFn(cb) ? interpretInlineFn(cb, []) : OPAQUE
      }
      if (method === 'useCallback') {
        return node.arguments[0] ? evaluate(node.arguments[0]) : OPAQUE
      }

      // op.query(q => …) / op.mutation(q => …): the callback param is the root.
      if (
        callee.object?.type === 'Identifier' &&
        isOpIdentifier(callee.object.name) &&
        (method === 'query' || method === 'mutation')
      ) {
        const root = registerSeed(node, 'operation', {opType: method})
        const cb = node.arguments[0] && unwrap(node.arguments[0])
        if (cb && isFn(cb)) {
          interpretInlineFn(cb, [{k: 'prov', prov: {root, path: []}}])
        }
        return OPAQUE
      }

      const base = evaluate(callee.object)

      // Invoking a closure carried on a concrete config object: `col.get(row)`.
      // (Only for obj/union bases, where `member` has no recording side effect;
      // data-prov bases fall through to the field-call handling below.)
      if (base.k === 'obj' || base.k === 'union') {
        const memberVal = member(base, mkStep(method))
        if (containsClosure(memberVal)) {
          const cargs = node.arguments.map((a: any) =>
            a.type === 'SpreadElement' ? evaluate(a.argument) : evaluate(a)
          )
          return invokeClosure(memberVal, cargs)
        }
      }

      if (ITERATOR_METHODS.has(method)) {
        return handleIterator(method, base, node)
      }
      if (BUILTIN_METHODS.has(method)) {
        // scalar builtin: base recorded; still evaluate args for their own reads.
        for (const a of node.arguments) evaluate(a)
        return OPAQUE
      }
      // GraphQL field call with args: base.method([args]). A zero-arg call still
      // marks `__args: ""` to distinguish it from a plain property access.
      const provs = provOf(base)
      if (provs.length > 0) {
        const arg0 = node.arguments[0]
        const args = arg0 ? argText(arg0) : ''
        if (arg0 && argRefsInput(arg0)) {
          for (const p of provs) if (p.root.kind === 'input') argInputs.add(p.root.input.name)
        }
        // args may themselves read data (rare) — evaluate for reads.
        for (const a of node.arguments) evaluate(a)
        const results: Supply[] = provs.map(p => {
          const np = extend(p, mkStep(method, args))
          recordInto(np.root, np.path)
          return {k: 'prov', prov: np} as Supply
        })
        return results.length === 1 ? results[0] : {k: 'union', of: results}
      }
      // external method (console.log, lib calls, …): args MUST be evaluated so
      // data reads inside them are recorded.
      for (const a of node.arguments) evaluate(a)
      return OPAQUE
    }

    // any other callee: resolve to a callable (closure or imported) and invoke.
    const argSupplies = node.arguments.map((a: any) =>
      a.type === 'SpreadElement' ? evaluate(a.argument) : evaluate(a)
    )
    const callable = resolveCallable(node.callee)
    if (callable) return invoke(callable, argSupplies)
    // unresolved: data args escape → over-select them.
    for (const s of argSupplies) recordAllReads(s)
    return OPAQUE
  }

  function handleIterator(method: string, base: Supply, node: any): Supply {
    // The callback may be inline OR a reference (`.forEach(walk)`, `.map(fn)`).
    const cbArg = node.arguments.find((a: any) => {
      const u = unwrap(a)
      return isFn(u) || u.type === 'Identifier'
    })
    const callable = cbArg ? resolveCallable(cbArg) : null
    const element = elementOf(base) // marks base as list + records
    const runCb = (elArg: number): Supply => {
      if (!callable) return OPAQUE
      const args: Supply[] = []
      args[elArg] = element
      return invoke(callable, args)
    }
    switch (method) {
      case 'map':
      case 'flatMap':
        return runCb(0) // list of mapped elements
      case 'reduce':
        runCb(1) // (acc, item) — the element is the SECOND param
        return OPAQUE
      case 'find':
        runCb(0)
        return element // returns a single element
      case 'at':
        return element
      case 'filter':
      case 'slice':
      case 'concat':
      case 'reverse':
      case 'sort':
      case 'flat':
      case 'toSorted':
      case 'toReversed':
        runCb(0)
        return element // still a list of the same elements
      case 'forEach':
      case 'some':
      case 'every':
      case 'findIndex':
        runCb(0)
        return OPAQUE
      default:
        runCb(0)
        return element
    }
  }

  /**
   * Interpret a CLOSURE inline — an iterator callback, a function expression, or a
   * function/component declared in an enclosing scope. It shares the current `env`
   * (so it can read the seed via lexical capture), binds its params to the supplied
   * args, and returns its value. Recursion is bounded (depth-2 unrolling); the
   * enclosing function's own return list is isolated so inline returns don't leak.
   */
  function interpretInlineFn(fn: any, args: Supply[]): Supply {
    const depth = inlineDepth.get(fn) ?? 0
    if (depth >= MAX_INLINE_DEPTH) return OPAQUE
    inlineDepth.set(fn, depth + 1)

    const saved: [string, Supply | undefined][] = []
    const bindLocal = (pat: any, sup: Supply) => {
      if (!pat) return
      if (pat.type === 'Identifier') {
        saved.push([pat.name, env.get(pat.name)])
        env.set(pat.name, sup)
      } else if (pat.type === 'ObjectPattern') {
        for (const p of pat.properties) {
          if (p.type === 'RestElement') continue
          const key = p.key?.name ?? p.key?.value
          bindLocal(p.value, member(sup, mkStep(String(key))))
        }
      } else if (pat.type === 'ArrayPattern') {
        pat.elements.forEach((el: any, i: number) => {
          if (el) bindLocal(el, member(sup, mkStep(String(i))))
        })
      } else if (pat.type === 'AssignmentPattern') bindLocal(pat.left, sup)
    }
    ;(fn.params ?? []).forEach((p: any, i: number) => bindLocal(p, args[i] ?? OPAQUE))

    // Isolate the enclosing fn's return accounting from this closure's returns.
    const savedLen = returnSupplies.length
    const savedLast = lastReturnSupply
    lastReturnSupply = undefined
    let result: Supply = OPAQUE
    if (fn.body?.type === 'BlockStatement') {
      interpretBlock(fn.body)
      result = lastReturnSupply ?? OPAQUE
    } else {
      result = evaluate(fn.body)
    }
    returnSupplies.length = savedLen
    lastReturnSupply = savedLast

    for (const [n, v] of saved) {
      if (v === undefined) env.delete(n)
      else env.set(n, v)
    }
    const nd = (inlineDepth.get(fn) ?? 1) - 1
    if (nd <= 0) inlineDepth.delete(fn)
    else inlineDepth.set(fn, nd)
    return result
  }

  /**
   * Interpret `fn` in a DIFFERENT frame — a cross-file component (fresh env, its own
   * file scope) or a closure in its captured defining frame. Unlike interpretInlineFn
   * it does NOT share the caller's lexical env: it starts from `fr.env` (empty for a
   * component, the captured env for a closure) plus the bound params, and resolves
   * names against `fr`'s file. This is what makes cross-file closure-config correct.
   */
  function interpretInFrame(fn: any, args: Supply[], fr: Frame): Supply {
    const depth = inlineDepth.get(fn) ?? 0
    if (depth >= MAX_INLINE_DEPTH) return OPAQUE
    inlineDepth.set(fn, depth + 1)

    const sFile = curFile, sScope = curScope, sText = curText, sLocal = localFns, sEnv = env
    curFile = fr.file
    curScope = fr.scope
    curText = fr.text
    localFns = fr.localFns
    env = new Map(fr.env)

    const bindFresh = (pat: any, sup: Supply) => {
      if (!pat) return
      if (pat.type === 'Identifier') env.set(pat.name, sup)
      else if (pat.type === 'ObjectPattern') {
        for (const p of pat.properties) {
          if (p.type === 'RestElement') continue
          const key = p.key?.name ?? p.key?.value
          bindFresh(p.value, member(sup, mkStep(String(key))))
        }
      } else if (pat.type === 'ArrayPattern') {
        pat.elements.forEach((el: any, i: number) => {
          if (el) bindFresh(el, member(sup, mkStep(String(i))))
        })
      } else if (pat.type === 'AssignmentPattern') bindFresh(pat.left, sup)
    }
    ;(fn.params ?? []).forEach((p: any, i: number) => bindFresh(p, args[i] ?? OPAQUE))

    const savedLen = returnSupplies.length
    const savedLast = lastReturnSupply
    lastReturnSupply = undefined
    let result: Supply = OPAQUE
    if (fn.body?.type === 'BlockStatement') {
      interpretBlock(fn.body)
      result = lastReturnSupply ?? OPAQUE
      walk(fn.body, (n: any) => {
        if (n.type === 'JSXElement') handleJsx(n.openingElement)
      })
      for (const lf of localFns.values()) interpretInlineFn(lf, [])
    } else if (fn.body) {
      result = evaluate(fn.body)
      walk(fn.body, (n: any) => {
        if (n.type === 'JSXElement') handleJsx(n.openingElement)
      })
    }
    returnSupplies.length = savedLen
    lastReturnSupply = savedLast

    curFile = sFile
    curScope = sScope
    curText = sText
    localFns = sLocal
    env = sEnv
    const nd = (inlineDepth.get(fn) ?? 1) - 1
    if (nd <= 0) inlineDepth.delete(fn)
    else inlineDepth.set(fn, nd)
    return result
  }

  /** Fold a resolved callee's summary at a call site. */
  function foldCall(loc: {file: string; node: any}, argSupplies: Supply[]): Supply {
    const summary = ctx.summaryOf(loc.file, loc.node)
    if (!summary) {
      // not yet computed (fixpoint bootstrap): args escape conservatively.
      for (const s of argSupplies) recordAllReads(s)
      return OPAQUE
    }
    // navigate a supply along a path (into obj / extend prov).
    const navigate = (sup: Supply, path: Path): Supply => {
      let cur = sup
      for (const st of path) cur = member(cur, st)
      return cur
    }
    // Build per-input supplies from arg supplies + input param paths.
    for (const input of summaryInputs(summary)) {
      const argSup = argSupplies[input.param] ?? OPAQUE
      const sup = navigate(argSup, input.path)
      const sel = summary.inputReads.get(input.name)
      if (sel) graftSupply(sup, sel)
    }
    // arg-input threading: if callee marks an input as an arg-input and the caller
    // supplied a data value there, propagate the arg-input marker.
    for (const name of summary.argInputs) {
      const input = summaryInputs(summary).find(i => i.name === name)
      if (!input) continue
      const argSup = argSupplies[input.param] ?? OPAQUE
      for (const p of provOf(navigate(argSup, input.path))) {
        if (p.root.kind === 'input') argInputs.add(p.root.input.name)
      }
    }
    return applyReturn(summary.ret, summary, argSupplies)
  }

  function applyReturn(ret: ReturnFact, summary: Summary, argSupplies: Supply[]): Supply {
    switch (ret.kind) {
      case 'passthrough': {
        if (ret.root.kind !== 'input') {
          // Concrete root the callee created (a seed via a custom hook, or a
          // mutation result). The caller's reads flow straight back to it.
          let cur: Supply = {k: 'prov', prov: {root: ret.root, path: []}}
          for (const st of ret.path) cur = member(cur, st)
          return cur
        }
        // Rooted at one of the callee's inputs → map to the caller's argument.
        const ri = ret.root.input
        const input = summaryInputs(summary).find(
          i => i.name === ri.name && i.param === ri.param
        )
        if (!input) return OPAQUE
        let cur = argSupplies[input.param] ?? OPAQUE
        for (const st of input.path) cur = member(cur, st)
        for (const st of ret.path) cur = member(cur, st)
        return cur
      }
      case 'object': {
        const props = new Map<string, Supply>()
        for (const [k, f] of ret.props) props.set(k, applyReturn(f, summary, argSupplies))
        return {k: 'obj', props}
      }
      case 'list':
        return applyReturn(ret.of, summary, argSupplies)
      default:
        return OPAQUE
    }
  }

  // ── statements ──
  let lastReturnSupply: Supply | undefined
  const returnSupplies: Supply[] = []

  function interpretBlock(block: any) {
    for (const stmt of block.body ?? []) interpretStmt(stmt)
  }

  function interpretStmt(stmt: any) {
    if (!stmt) return
    switch (stmt.type) {
      case 'VariableDeclaration': {
        for (const d of stmt.declarations) {
          if (!d.init) continue
          const val = evaluate(d.init)
          bindDeclarator(d.id, val)
        }
        return
      }
      case 'ExpressionStatement':
        evaluate(stmt.expression)
        return
      case 'ReturnStatement': {
        if (stmt.argument) {
          const s = evaluate(stmt.argument)
          lastReturnSupply = s
          returnSupplies.push(s)
        }
        return
      }
      case 'IfStatement':
        evaluate(stmt.test)
        interpretStmt(stmt.consequent)
        if (stmt.alternate) interpretStmt(stmt.alternate)
        return
      case 'BlockStatement':
        interpretBlock(stmt)
        return
      case 'ForOfStatement': {
        const iter = evaluate(stmt.right)
        const el = elementOf(iter)
        if (stmt.left?.type === 'VariableDeclaration') {
          bindDeclarator(stmt.left.declarations[0].id, el)
        }
        interpretStmt(stmt.body)
        return
      }
      case 'ForStatement':
      case 'WhileStatement':
        if ((stmt as any).body) interpretStmt((stmt as any).body)
        return
      case 'SwitchStatement':
        evaluate(stmt.discriminant)
        for (const c of stmt.cases) for (const s of c.consequent) interpretStmt(s)
        return
      case 'TryStatement':
        interpretBlock(stmt.block)
        if (stmt.handler) interpretBlock(stmt.handler.body)
        return
      default:
        // JSX / other: walk for nested expressions we care about.
        walk(stmt, n => {
          if (n.type === 'JSXElement') handleJsx(n.openingElement)
        })
        return
    }
  }

  function bindDeclarator(id: any, val: Supply) {
    if (!id) return
    if (id.type === 'Identifier') {
      env.set(id.name, val)
    } else if (id.type === 'ObjectPattern') {
      for (const p of id.properties) {
        if (p.type === 'RestElement') continue
        const key = p.key?.name ?? p.key?.value
        if (key == null) continue
        bindDeclarator(p.value, member(val, mkStep(String(key))))
      }
    } else if (id.type === 'ArrayPattern') {
      id.elements.forEach((el: any, i: number) => {
        if (el) bindDeclarator(el, member(val, mkStep(String(i))))
      })
    }
  }

  // ── JSX components: props are named inputs ──
  function handleJsx(opening: any) {
    if (!opening) return
    const nameNode = opening.name
    const tag =
      nameNode?.type === 'JSXIdentifier'
        ? nameNode.name
        : nameNode?.type === 'JSXMemberExpression'
          ? nameNode.property?.name
          : undefined
    // evaluate attribute expressions (records reads) and build props supply.
    const propsObj = new Map<string, Supply>()
    for (const attr of opening.attributes ?? []) {
      if (attr.type !== 'JSXAttribute') continue
      const an = attr.name?.name
      if (!an) continue
      const v = attr.value
      const sup =
        v?.type === 'JSXExpressionContainer' ? evaluate(v.expression) : OPAQUE
      propsObj.set(an, sup)
    }
    if (!tag || tag[0] === tag[0].toLowerCase()) return // host element
    // A component is just a callable whose single arg is the props object; route it
    // through the same closure/summary model as any other call. `<NS.Member/>`
    // (namespace import) is resolved as a member expression.
    const calleeExpr =
      nameNode?.type === 'JSXMemberExpression' && nameNode.object?.type === 'JSXIdentifier'
        ? {type: 'MemberExpression', computed: false, object: {type: 'Identifier', name: nameNode.object.name}, property: {type: 'Identifier', name: tag}}
        : {type: 'Identifier', name: tag}
    const callable = resolveCallable(calleeExpr)
    const propsSupply: Supply = {k: 'obj', props: propsObj}
    if (callable) invoke(callable, [propsSupply])
    else for (const s of propsObj.values()) recordAllReads(s)
  }

  // ── drive the body ──
  const body = fnNode.body
  if (body?.type === 'BlockStatement') {
    interpretBlock(body)
    // also scan JSX returns inside the block
    walk(body, n => {
      if (n.type === 'JSXElement') handleJsx(n.openingElement)
    })
    // Local functions (event handlers, effects) are closures over this scope that
    // WILL run — interpret each once (params opaque) so their reads (e.g. a
    // mutation trigger's awaited result) are captured. Idempotent with any direct
    // calls; the env now holds this scope's bindings (the trigger, locals).
    for (const fn of localFns.values()) interpretInlineFn(fn, [])
  } else if (body) {
    const s = evaluate(body)
    returnSupplies.push(s)
    walk(body, n => {
      if (n.type === 'JSXElement') handleJsx(n.openingElement)
    })
  }

  const ret = computeReturnFact(returnSupplies, inputs)

  const summary: Summary = {fn: self, inputReads, argInputs, ret}
  INPUTS.set(summary, inputs)
  return summary
}

// ── helpers to read inputs back off a summary (v1 stores them on the summary) ──
const INPUTS = new WeakMap<Summary, InputId[]>()
function summaryInputs(s: Summary): InputId[] {
  return INPUTS.get(s) ?? []
}
function computeReturnFact(returns: any[], inputs: InputId[]): ReturnFact {
  if (returns.length === 0) return {kind: 'none'}
  // v1: use the first return; unions collapse to opaque unless all passthrough.
  const first = returns[0]
  return supplyToReturn(first, inputs)
}

function supplyToReturn(sup: any, inputs: InputId[]): ReturnFact {
  if (!sup) return {kind: 'opaque'}
  if (sup.k === 'prov') {
    return {kind: 'passthrough', root: sup.prov.root, path: sup.prov.path}
  }
  if (sup.k === 'obj') {
    const props = new Map<string, ReturnFact>()
    for (const [k, v] of sup.props) props.set(k, supplyToReturn(v, inputs))
    return {kind: 'object', props}
  }
  if (sup.k === 'union') {
    // v1: reconstruct as opaque if heterogeneous.
    return {kind: 'opaque'}
  }
  return {kind: 'opaque'}
}

export {INPUTS}
