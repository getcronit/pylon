/**
 * Core data model for the oxc-based useData analyzer.
 *
 * The analyzer is a whole-program, summary-based interprocedural data-flow pass.
 * It answers one question per `useData()`/`usePaginatedData()`/`useMutation()`/`op.*`
 * call: which fields of the returned handle are read across the whole component
 * graph (including values prop-drilled into imported components), so the reads can
 * be compiled into a single GraphQL document.
 *
 * The lattice value carried through the analysis is a `SelectorNode` — the SAME
 * shape the existing lowering (`selectors-to-document.ts` / `query/build/compile.ts`)
 * consumes — so this analyzer is a drop-in replacement for the tracer half of the
 * pipeline and reuses all lowering + the whole test corpus as its safety net.
 */

// `SelectorNode` is the lowering layer's input contract (parser-agnostic), so this
// module depends on the neutral query-build layer, never on either analyzer.
import type {SelectorNode} from '../../../../../../query/build/compile'

export type {SelectorNode}

/**
 * A step in an access path. `key` is the field/property name; `args` is the
 * stringified call arguments when the step was a call (`data.user({id})` → step
 * `{key:'user', args:'{id}'}`); `list` marks a step that iterates (a `.map`
 * callback element, an array index) so the compiled selection nests correctly.
 */
export interface Step {
  key: string
  args?: string
  list?: boolean
}

export type Path = Step[]

/** Symbol identity within a single parsed file: a stable id for a binding. */
export type SymbolId = string

/** A function/component that summaries are computed for, addressed globally. */
export interface FnRef {
  /** Absolute file path of the declaring module. */
  file: string
  /** Stable id of the function node within that file (source span based). */
  id: string
}

/** A named input to a function: a parameter binding (after destructuring) or a
 *  JSX/props member. Identified by the declaring function + the local binding. */
export interface InputId {
  fn: FnRef
  /** Local binding name the input is bound to inside the function body. */
  name: string
  /** Access path from the raw parameter to this binding (destructuring), e.g.
   *  `function Row({item})` → name `item`, path `[{key:'item'}]` off param 0. */
  param: number
  path: Path
}

/** A `useData()`-family call: the concrete root created inside one function body. */
export interface SeedId {
  fn: FnRef
  /** Source-span key of the call expression. */
  call: string
  kind: SeedKind
}

export type SeedKind = 'query' | 'paginated' | 'mutation' | 'operation'

/** Where an in-flight value came from. A value is either rooted at a locally
 *  created seed, or at one of the enclosing function's inputs (abstract). */
export type Root =
  | {kind: 'seed'; seed: SeedId}
  | {kind: 'input'; input: InputId}
  // useMutation: the `[trigger]` binding, and the value a `await trigger(...)`
  // returns. Reads off the latter become the mutation's nested return selection.
  | {kind: 'mutation-trigger'; seedKey: string}
  | {kind: 'mutation-nested'; seedKey: string}

/** Provenance of an in-flight value: its root + the access path already taken. */
export interface Prov {
  root: Root
  path: Path
}

/**
 * What a function returns, expressed purely in terms of its inputs, so a caller
 * can continue tracking the returned value without re-entering the body.
 *
 *  - `passthrough`: returns one input, extended by `path`
 *    (`getOwner(o) => o.owner` → passthrough input `o`, path `[owner]`).
 *  - `object`: a reconstructed object literal; each key maps to its own fact
 *    (`h => ({name: o.name})` → object {name: passthrough o.[name]}).
 *  - `list`: a list whose elements carry `of`
 *    (`xs => xs.map(x => x.a)` → list of passthrough element.[a]).
 *  - `opaque`: unfollowable — the caller widens to `allScalars` (safety net).
 */
export type ReturnFact =
  | {kind: 'none'}
  // Returns a value rooted at one of the callee's inputs (mapped to the caller's
  // argument at the call site) or at a seed the callee created (a custom hook
  // returning `useData().x` — the caller's reads flow back to that seed).
  | {kind: 'passthrough'; root: Root; path: Path}
  | {kind: 'object'; props: Map<string, ReturnFact>}
  | {kind: 'list'; of: ReturnFact}
  | {kind: 'opaque'}

/**
 * The closed-form behavior of one function, relative to its inputs. Computed once
 * per function (memoized by content hash), composed at call sites without
 * re-interpreting the body — this is what removes the old per-caller re-analysis.
 */
export interface Summary {
  fn: FnRef
  /** Fields read off each input within the body (paths relative to the input). */
  inputReads: Map<string, SelectorNode>
  /** Inputs that reach a GraphQL field ARGUMENT position, so a call site knows the
   *  value must be threaded into the variables thunk at the useData scope. */
  argInputs: Set<string>
  /** What the function's value flows out as. */
  ret: ReturnFact
}

/** The selection accumulated for one seed after whole-program propagation. */
export interface SeedResult {
  seed: SeedId
  selectors: SelectorNode
}
