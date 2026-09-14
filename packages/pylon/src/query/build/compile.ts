import {
  getNamedType,
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLSchema,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  Kind,
  parse,
  type GraphQLField,
  type GraphQLInterfaceType,
  type GraphQLOutputType,
  type GraphQLUnionType,
  type SelectionSetNode
} from 'graphql'
import type {ConnectionMeta, ShapeField} from '../runtime/doc'

/**
 * Derive the compact completeness `shape` (see runtime `ShapeField`) from the
 * finished wire `body`. The body IS the selection — deriving from it (rather than
 * a hand-maintained parallel structure) keeps the shape provably in lockstep with
 * what's sent, while parsing stays at BUILD time so the runtime ships no parser.
 *
 * Response keys are field aliases where present (so `timeline__pqArg__0` etc. are
 * checked under the key they actually arrive as); inline fragments tag their fields
 * with a `__typename` condition so a Ticket-only field isn't demanded of a Task.
 */
function buildShape(body: string): ShapeField[] {
  const op = parse(body).definitions.find(
    d => d.kind === Kind.OPERATION_DEFINITION
  )
  return op && 'selectionSet' in op ? shapeOfSelectionSet(op.selectionSet) : []
}

function shapeOfSelectionSet(sel: SelectionSetNode): ShapeField[] {
  const out: ShapeField[] = []
  for (const s of sel.selections) {
    if (s.kind === Kind.FIELD) {
      // Mirror `normalize`: a `__pqAbs__` union-branch alias is stored under its
      // BASE name (`status__pqAbs__Ticket` → `status`), so the shape must check
      // that same base key — an arg-alias (`timeline__pqArg__0`) is NOT rewritten
      // and stays as-is.
      const rawKey = (s.alias ?? s.name).value
      const abs = rawKey.indexOf('__pqAbs__')
      const field: ShapeField = {k: abs === -1 ? rawKey : rawKey.slice(0, abs)}
      if (s.selectionSet) field.s = shapeOfSelectionSet(s.selectionSet)
      out.push(field)
    } else if (s.kind === Kind.INLINE_FRAGMENT) {
      // Flatten `... on X { … }` into its fields, each gated on the concrete type.
      const t = s.typeCondition?.name.value
      for (const inner of shapeOfSelectionSet(s.selectionSet)) {
        out.push(t ? {...inner, t} : inner)
      }
    }
    // FragmentSpread: the compiler emits only INLINE fragments → nothing to do.
  }
  return out
}

/** One selector node from the use-data analyzer (mirrors its `SelectorNode`). */
export type SelectorNode = {
  [key: string]: SelectorNode | SelectorNode[] | boolean | string | undefined
  __args?: string
  __isList?: boolean
}

export interface CompiledVariable {
  /** Variable name, e.g. "v0". */
  name: string
  /** JS source expression supplying its value, copied from the call site. */
  expr: string
}

/**
 * Variable name carrying the locale. Underscore-prefixed so it cannot collide with a field
 * argument the analyzer derived from user code.
 */
export const IN_CONTEXT_VARIABLE = '__locale'

/**
 * Variable name carrying the per-operation context bag (JSON string). Underscore-prefixed
 * like `__locale`, and rides the SAME `@inContext` directive. Emitted on EVERY compiled
 * operation (no config gate — it's inert until the server acts on it); the client supplies
 * the value per call, so it lands in the cache key (`variablesHash`) by construction. See
 * rfcs/ACTING_TENANT.md.
 */
export const OP_CONTEXT_VARIABLE = '__context'

export interface CompileOptions {
  /** Operation name. */
  name: string
  /**
   * Emit `@inContext(locale: $__locale)` on the operation, so resolvers can read the
   * locale via `getLocale()`. Set by the pages build when `usePages({i18n})` is configured.
   */
  inContext?: boolean
  /** Operation type — "query" (default) or "mutation". */
  operation?: 'query' | 'mutation'
  /** GraphQL scalar name → TS type (e.g. {Number: "number"}). */
  scalarTypes?: Record<string, string>
  /**
   * Compile as a Relay connection: force pagination variables on the field at
   * this path (length-1, top-level field) and select the full connection shape.
   */
  connection?: {path: string[]}
  /**
   * Top-level field whose arguments are declared as RUNTIME variables (named by
   * arg) supplied at call time, not from the source. Used for mutations:
   * `mutate(vars)` provides them.
   */
  runtimeArgsField?: string
  /**
   * For imperative `op` selectors: when an object is returned with no explicit
   * sub-selection, fetch all of its (argument-free) scalar/enum fields instead of
   * just `__typename`. Makes `op.query(q => q.user({id}))` fetch the whole user,
   * so any scalar read off the awaited result resolves — matching gqty `resolve`.
   */
  fillObjectLeaves?: boolean
}

/** One arg-branch of a root field read with multiple different-args call sites. */
export interface ArgAliasBranch {
  /** Response field name: the base field for branch 0, else `field__pqArg__N`. */
  alias: string
  /** argName → variable name — lets the runtime match a call's args to this branch. */
  args: Record<string, string>
}

/**
 * A field selection that carries arguments, keyed `OwnerType.responseKey`. The runtime
 * uses it to give ENTITY arg-fields an args-inclusive STORAGE KEY, so
 * `ticket.message(id:A)` and `ticket.message(id:B)` don't collide on the same
 * `Ticket:1` slot (a bare field name is only a valid entity slot for argument-free
 * fields). `responseKey` is the field name for a lone selection, or its `__pqArg__N`
 * alias for one branch of a same-query collision.
 */
export interface ArgSlot {
  /** The underlying field name (the storage key's stable prefix). */
  field: string
  /** argName → variable name — resolved against the op's variables to key the slot. */
  argVars: Record<string, string>
}

export interface CompiledOperation {
  name: string
  /** GraphQL operation source sent over the wire. */
  body: string
  /** The operation declares `$__locale`; the client must supply it. */
  inContext?: boolean
  /** The operation declares `$__context` (always true for compiled ops); the client
   *  supplies the per-call `OperationContext` bag as a JSON string. */
  opContext?: boolean
  /** TS type literal for the result root, e.g. "{ me: { name: string } }". */
  resultType: string
  /** Variables whose values come from the call site (the thunk). */
  variables: CompiledVariable[]
  /** Present iff `options.connection` was given. */
  connection?: ConnectionMeta
  /**
   * Root fields read with MULTIPLE different-args call sites — each emitted as its own
   * aliased field. fieldName → branches, so the runtime can resolve `data.field(args)`
   * to the branch whose args match. Absent when no field has multiple arg-branches.
   */
  argAliases?: Record<string, ArgAliasBranch[]>
  /**
   * Every arg-bearing field selection, keyed `OwnerType.responseKey`. Drives the
   * runtime's args-inclusive entity storage keys (see `ArgSlot`). Absent when no
   * selected field takes arguments.
   */
  argSlots?: Record<string, ArgSlot>
  /**
   * Compact selection shape (response keys + nesting) driving the runtime
   * completeness gate. Present for queries; absent for mutations.
   */
  shape?: ShapeField[]
}

const DEFAULT_SCALARS: Record<string, string> = {
  String: 'string',
  ID: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean'
}

/**
 * Selector tree of every (argument-free) scalar/enum field on a type. Used to
 * build the `allScalars(ReturnType)` part of a mutation's return selection — so
 * the mutation refreshes the full entity in the cache, not just the fields the
 * handler happened to read.
 */
export function allScalarSelectors(
  schema: GraphQLSchema,
  typeName: string
): SelectorNode {
  const type = schema.getType(typeName)
  if (!type || !isObjectType(type)) return {}
  const out: SelectorNode = {}
  for (const field of Object.values(type.getFields())) {
    if (field.args.length > 0) continue // can't auto-select arg fields
    const named = getNamedType(field.type)
    if (isScalarType(named) || isEnumType(named)) out[field.name] = true
  }
  return out
}

/**
 * Default selection for a MUTATION result.
 *
 * Two shapes, distinguished by whether the return type has an `id`:
 *
 *  - Entity return (`createUser: User`, has `id`): its own scalars already
 *    normalize and live-update the cache — behave exactly like `allScalars` and
 *    do NOT expand relations (no over-fetching `user.posts` etc.).
 *  - Payload wrapper (`{ ticket: Ticket, userErrors: [UserError] }`, no `id`):
 *    the first layer is all objects, so `allScalars` selects nothing and the
 *    result never updates the cache. Recurse ONE level — payload scalars + each
 *    object/list field's scalars (incl. their `id`, so the wrapped entity
 *    normalizes and live-updates every reader).
 *
 * Either way, the analyzer's trigger-return reads still add deeper relation
 * selections on top.
 */
export function mutationResultSelectors(
  schema: GraphQLSchema,
  typeName: string
): SelectorNode {
  const type = schema.getType(typeName)
  if (!type || !isObjectType(type)) return {}
  const fields = type.getFields()
  // Entity return: own scalars are enough (and normalizable). Don't pull in
  // relations — those come from explicit trigger-return reads when needed.
  if (fields.id) return allScalarSelectors(schema, typeName)
  // Payload wrapper: recurse one level so each wrapped entity/error selects its
  // scalars and normalizes.
  const out: SelectorNode = {}
  for (const field of Object.values(fields)) {
    if (field.args.length > 0) continue
    const named = getNamedType(field.type)
    if (isScalarType(named) || isEnumType(named)) {
      out[field.name] = true
    } else if (isObjectType(named)) {
      out[field.name] = allScalarSelectors(schema, named.name)
    }
  }
  return out
}

const PAGINATION_ARGS = ['first', 'after', 'last', 'before', 'skip'] as const

/**
 * Lower an analyzer selector tree into a typed GraphQL operation. This is the
 * replacement for `generatePrepare` — instead of a gqty prepare closure we emit
 * a real document, a precise TS result type, and the call-site variables.
 *
 * Fails loud (throws) on anything it can't statically resolve, per the design's
 * "analyzer is the contract" stance.
 */
export function compileOperation(
  schema: GraphQLSchema,
  selectors: SelectorNode,
  options: CompileOptions
): CompiledOperation {
  const operation = options.operation ?? 'query'
  const rootType =
    operation === 'mutation' ? schema.getMutationType() : schema.getQueryType()
  if (!rootType) {
    throw new Error(`Schema has no ${operation === 'mutation' ? 'Mutation' : 'Query'} type`)
  }

  const ctx: Ctx = {
    schema,
    scalars: {...DEFAULT_SCALARS, ...(options.scalarTypes ?? {})},
    varCount: 0,
    variables: [],
    connVarDecls: [],
    runtimeVarDecls: [],
    runtimeArgsField: options.runtimeArgsField,
    connectionOpt: options.connection,
    connectionPath: options.connection?.path,
    connectionMeta: undefined,
    fillObjectLeaves: options.fillObjectLeaves ?? false,
    argAliases: {},
    argAliasRegistry: new Map(),
    argSlots: {}
  }

  // Root operation type is not an entity → no __typename/id injection.
  const {sdl, ts} = compileObject(ctx, rootType, selectors, [], false)

  const allDecls = [
    ...ctx.variables.map(v => `$${v.name}: ${v.gqlType}`),
    ...ctx.runtimeVarDecls,
    ...ctx.connVarDecls
  ]
  // `@inContext` carries request context INSIDE the document, as variables, so one compiled
  // document serves every value AND the value lands in the client's cache key
  // (`documentId ~ variablesHash`). A header would leave those keys identical across values
  // — see core/in-context.ts.
  //
  // The variable declaration and the directive are inseparable: GraphQL rejects a declared
  // variable that is never used, so the directive is what makes `$__locale` / `$__actingTenant`
  // legal. That is the same constraint that pushed Shopify to a directive. `locale` and
  // `actingTenant` share ONE directive when both are enabled.
  const inContextArgs: string[] = []
  if (options.inContext) {
    allDecls.push(`$${IN_CONTEXT_VARIABLE}: String`)
    inContextArgs.push(`locale: $${IN_CONTEXT_VARIABLE}`)
  }
  // The per-operation context channel is ALWAYS compiled in (no config gate): the value is
  // supplied per call and inert until the server acts on it. `context` rides as a JSON
  // String so this directive stays app-independent — the app's `OperationContext` shape
  // lives in TS, never in the SDL.
  allDecls.push(`$${OP_CONTEXT_VARIABLE}: String`)
  inContextArgs.push(`context: $${OP_CONTEXT_VARIABLE}`)
  const varDecls = allDecls.length ? `(${allDecls.join(', ')})` : ''
  const directives = ` @inContext(${inContextArgs.join(', ')})`

  const body = `${operation} ${options.name}${varDecls}${directives} ${sdl}`

  return {
    name: options.name,
    body,
    inContext: options.inContext || undefined,
    opContext: true,
    resultType: ts,
    variables: ctx.variables.map(v => ({name: v.name, expr: v.expr})),
    connection: ctx.connectionMeta,
    argAliases: Object.keys(ctx.argAliases).length ? ctx.argAliases : undefined,
    argSlots: Object.keys(ctx.argSlots).length ? ctx.argSlots : undefined,
    // Completeness shape drives the runtime read gate — queries only. Mutations
    // don't flow through `ensure`/Suspense, so they carry no shape.
    shape: operation === 'mutation' ? undefined : buildShape(body)
  }
}

interface Ctx {
  schema: GraphQLSchema
  scalars: Record<string, string>
  varCount: number
  variables: Array<{name: string; gqlType: string; expr: string}>
  /** Declarations for runtime-supplied connection vars (no call-site expr). */
  connVarDecls: string[]
  /** Declarations for runtime-supplied mutation-arg vars (no call-site expr). */
  runtimeVarDecls: string[]
  /** Field whose args become runtime variables (the mutation field). */
  runtimeArgsField?: string
  connectionOpt?: {path: string[]}
  /** Path (any depth) to the connection field, e.g. ["post","comments"]. */
  connectionPath?: string[]
  connectionMeta?: ConnectionMeta
  /** op: expand bare-object returns to allScalars (see CompileOptions). */
  fillObjectLeaves: boolean
  /** Accumulated per-field arg-branch aliases (see CompiledOperation.argAliases). */
  argAliases: Record<string, ArgAliasBranch[]>
  /** Accumulated arg-bearing field selections (see CompiledOperation.argSlots). */
  argSlots: Record<string, ArgSlot>
  /** `Type.field` → (raw args source → response alias). One registry per operation, so a
   *  field read with the same args at two different positions resolves to the same slot
   *  and the branch that owns the BASE name is picked once, not per position. */
  argAliasRegistry: Map<string, Map<string, string>>
}

function pathsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function allocVar(ctx: Ctx, gqlType: string, expr: string): string {
  const name = `v${ctx.varCount++}`
  ctx.variables.push({name, gqlType, expr})
  return name
}

/**
 * Compile a selection set against an object type. Returns SDL + TS literal.
 *
 * `injectMeta` (default true) auto-selects `__typename`, and `id` when the type
 * has it, so the store can normalize the object into the entity table. The root
 * operation type passes `false` (it isn't an entity).
 */
function compileObject(
  ctx: Ctx,
  type: GraphQLObjectType,
  node: SelectorNode,
  currentPath: string[],
  injectMeta = true
): {sdl: string; ts: string} {
  const fields = type.getFields()
  const selections: string[] = []
  const tsMembers: string[] = []
  const selected = new Set<string>()

  // op `fillObjectLeaves`: a returned object with no explicit field projection
  // fetches all (argument-free) scalar/enum fields, so any scalar read off the
  // awaited result resolves. Injected before the loop so wrappers/meta apply.
  let effectiveNode = node
  if (ctx.fillObjectLeaves) {
    const hasUserFields = Object.keys(node).some(
      k => k !== '__args' && k !== '__isList' && k !== '__typename'
    )
    if (!hasUserFields) {
      effectiveNode = {...node}
      for (const f of Object.values(fields)) {
        if (f.args.length > 0) continue
        const n = getNamedType(f.type)
        if (isScalarType(n) || isEnumType(n)) effectiveNode[f.name] = true
      }
    }
  }

  for (const key of Object.keys(effectiveNode)) {
    if (key === '__args' || key === '__isList') continue
    if (key === '__typename') {
      selections.push('__typename')
      tsMembers.push('__typename?: string')
      selected.add('__typename')
      continue
    }

    const field = fields[key]
    if (!field) {
      throw new Error(
        `Field "${key}" does not exist on type "${type.name}". ` +
          `The useData selection references a field the schema doesn't have.`
      )
    }
    selected.add(key)

    const value = effectiveNode[key]
    const fieldPath = [...currentPath, key]

    // A field read at MULTIPLE different-args call sites → the analyzer models it as an
    // array of arg-branches. Emit one aliased field per branch instead of collapsing to
    // first-args, and record the arg→variable map so the runtime can route
    // `data.…field(args)` to the matching branch.
    //
    // This used to be restricted to ROOT fields, on the theory that's "where the
    // collisions occur". They occur at any depth: three reads of
    // `ticket.timeline({query: "kind:EMAIL" | "kind:NOTE" | "kind:EVENT"}).totalCount`
    // compiled to ONE `timeline(query: $v1)` and reported the first branch's number for
    // all three — silently, since each is a plausible count. Skipped for
    // connection/runtime-arg fields, which own their args by other means.
    const branches = Array.isArray(value)
      ? (value.filter(b => b && typeof b === 'object') as SelectorNode[])
      : null
    const isConnField =
      !!ctx.connectionPath && pathsEqual(fieldPath, ctx.connectionPath)
    const isRuntimeArgsField =
      !!ctx.runtimeArgsField && key === ctx.runtimeArgsField
    // Only ARG-branches alias: every branch must carry a DISTINCT, defined `__args`.
    // No-args / conditional branches (`cond ? data.me.name : data.me.age`) still merge.
    const isArgBranchSet =
      !!branches &&
      branches.length > 1 &&
      branches.every(b => b.__args !== undefined) &&
      new Set(branches.map(b => b.__args)).size === branches.length
    if (branches && isArgBranchSet && !isConnField && !isRuntimeArgsField) {
      // Keyed by OWNER TYPE + field, not by field name alone: the runtime knows the type
      // of the object it is reading from, but not its document path (a connection's rows
      // are reached as `edges.node`, which no compile-time path matches), so `Type.field`
      // is the identity both sides can agree on.
      const aliasKey = `${type.name}.${key}`
      let slots = ctx.argAliasRegistry.get(aliasKey)
      if (!slots) ctx.argAliasRegistry.set(aliasKey, (slots = new Map()))
      const meta: ArgAliasBranch[] = ctx.argAliases[aliasKey] ?? []
      let tsEmitted = false
      for (const branch of branches) {
        const argsSrc = branch.__args as string
        // First args ever seen for this field keep the BASE name — a bare, argument-less
        // read (`data.field`) has to land somewhere.
        let alias = slots.get(argsSrc)
        if (alias === undefined) {
          alias = slots.size === 0 ? key : `${key}__pqArg__${slots.size}`
          slots.set(argsSrc, alias)
        }
        const {sdl, ts, argVars} = compileField(ctx, field, branch, fieldPath)
        selections.push(alias === key ? `${key}${sdl}` : `${alias}: ${key}${sdl}`)
        if (!tsEmitted) {
          tsMembers.push(`${key}: ${ts}`) // TS type needs the field only once
          tsEmitted = true
        }
        if (!meta.some(m => m.alias === alias)) meta.push({alias, args: argVars ?? {}})
        // Storage-key metadata keyed by the RESPONSE key (the alias), so normalize can
        // rekey each branch's entity slot by its own args.
        ctx.argSlots[`${type.name}.${alias}`] = {field: key, argVars: argVars ?? {}}
      }
      ctx.argAliases[aliasKey] = meta
      continue
    }

    const merged = mergeBranches(value)

    // Terminal connection field (top-level or nested at any depth).
    if (ctx.connectionPath && pathsEqual(fieldPath, ctx.connectionPath)) {
      const {sdl, ts} = compileConnectionField(ctx, field, merged)
      selections.push(`${key}${sdl}`)
      tsMembers.push(`${key}: ${ts}`)
      continue
    }

    if (ctx.runtimeArgsField && key === ctx.runtimeArgsField) {
      const {sdl, ts} = compileRuntimeArgsField(ctx, field, merged)
      selections.push(`${key}${sdl}`)
      tsMembers.push(`${key}: ${ts}`)
      continue
    }

    const {sdl, ts, argVars} = compileField(ctx, field, merged, fieldPath)
    selections.push(`${key}${sdl}`)
    tsMembers.push(`${key}: ${ts}`)
    // A lone arg-bearing selection is never aliased (no same-query collision), so it
    // lands on the bare response key — record it so normalize gives it an
    // args-inclusive entity storage key and it can't be clobbered cross-query.
    if (argVars && Object.keys(argVars).length) {
      ctx.argSlots[`${type.name}.${key}`] = {field: key, argVars}
    }
  }

  // Normalization metadata — added to the wire document only (not the TS type;
  // these are infra fields the user didn't select).
  if (injectMeta) {
    if (!selected.has('__typename')) selections.push('__typename')
    if (fields['id'] && !selected.has('id')) selections.push('id')
  }

  if (selections.length === 0) {
    // Object selected without any subfields — keep the document valid.
    selections.push('__typename')
    tsMembers.push('__typename?: string')
  }

  return {
    sdl: `{ ${selections.join(' ')} }`,
    ts: `{ ${tsMembers.join('; ')} }`
  }
}

/** Compile a single field (args + nested selection + TS type). */
function compileField(
  ctx: Ctx,
  field: GraphQLField<any, any>,
  node: SelectorNode | boolean,
  currentPath: string[]
): {sdl: string; ts: string; argVars?: Record<string, string>} {
  // Terminal connection field, reached via ANY path — a concrete object OR an abstract
  // (interface/union) member. Connection detection must live here too, not only in
  // `compileObject`, so a connection selected THROUGH an interface field still gets
  // recognised (e.g. an STI base: `contact` is `interface Contact`, and
  // `contact.ticketAttachments` is the connection). Otherwise the hook-only feed props
  // (loadNext/isLoadingMore/…) leak into the selection and fail schema validation.
  if (
    ctx.connectionPath &&
    typeof node === 'object' &&
    pathsEqual(currentPath, ctx.connectionPath)
  ) {
    return compileConnectionField(ctx, field, node)
  }

  const {sdl: argsSdl, argVars} =
    typeof node === 'object'
      ? compileArgs(ctx, field, node.__args)
      : {sdl: '', argVars: {} as Record<string, string>}
  const named = getNamedType(field.type)

  let innerSdl = ''
  let innerTs: string

  if (isScalarType(named)) {
    innerTs = ctx.scalars[named.name] ?? 'any'
  } else if (isEnumType(named)) {
    innerTs = enumTs(named)
  } else if (isObjectType(named)) {
    if (typeof node !== 'object') {
      if (ctx.fillObjectLeaves) {
        // op: a bare object return (`q.me`) fetches all its scalars.
        const sub = compileObject(ctx, named, {}, currentPath)
        innerSdl = ` ${sub.sdl}`
        innerTs = sub.ts
      } else {
        // Object field selected as a leaf — keep valid with __typename.
        innerSdl = ' { __typename }'
        innerTs = '{ __typename?: string }'
      }
    } else {
      const sub = compileObject(ctx, named, node, currentPath)
      innerSdl = ` ${sub.sdl}`
      innerTs = sub.ts
    }
  } else if (isInterfaceType(named) || isUnionType(named)) {
    const sub =
      typeof node === 'object'
        ? compileInterfaceUnionField(ctx, named, node, currentPath)
        : {sdl: '{ __typename }', ts: '{ __typename?: string }'}
    innerSdl = ` ${sub.sdl}`
    innerTs = sub.ts
  } else {
    innerSdl = ' { __typename }'
    innerTs = '{ __typename?: string }'
  }

  return {
    sdl: `${argsSdl}${innerSdl}`,
    ts: applyWrappers(field.type, innerTs),
    argVars
  }
}

/** Build the `(arg: $vN, …)` SDL, register variables, and return the arg→variable map
 *  (used to build per-branch `argAliases` metadata for same-field/different-args reads). */
function compileArgs(
  ctx: Ctx,
  field: GraphQLField<any, any>,
  rawArgs: string | undefined
): {sdl: string; argVars: Record<string, string>} {
  const argVars: Record<string, string> = {}
  if (rawArgs == null) return {sdl: '', argVars}
  // Lazy import to keep the parser self-contained.
  const parsed = parseArgsOrThrow(rawArgs, field.name)
  const keys = Object.keys(parsed)
  if (keys.length === 0) return {sdl: '', argVars}

  const parts: string[] = []
  for (const argName of keys) {
    const argDef = field.args.find(a => a.name === argName)
    if (!argDef) {
      throw new Error(
        `Field "${field.name}" has no argument "${argName}" ` +
          `(used in a useData selection).`
      )
    }
    const varName = allocVar(ctx, argDef.type.toString(), parsed[argName])
    argVars[argName] = varName
    parts.push(`${argName}: $${varName}`)
  }
  return {sdl: `(${parts.join(', ')})`, argVars}
}

/**
 * Restrict a merged sub-selection to the fields a concrete object type declares,
 * recursing into object sub-fields. Used to partition a polymorphic field whose
 * sub-type differs per member (`items` = `TimelineEntry` on one, `NumberedEntry`
 * on another): each member fragment keeps only its own entry's fields. Keys not on
 * this type belong to a sibling member (already proven claimed elsewhere) and are
 * dropped; `__args`/`__isList` markers are preserved.
 */
function projectSelectionOntoType(
  node: SelectorNode,
  gqlType: GraphQLOutputType
): SelectorNode {
  const named = getNamedType(gqlType)
  if (!isObjectType(named)) return node // scalar/enum leaf or abstract — leave as-is
  const fields = named.getFields()
  const out: SelectorNode = {}
  if (node.__args !== undefined) out.__args = node.__args
  if (node.__isList !== undefined) out.__isList = node.__isList
  for (const key of Object.keys(node)) {
    if (key === '__args' || key === '__isList') continue
    if (key === '__typename') {
      out[key] = node[key]
      continue
    }
    const f = fields[key]
    if (!f) continue // sibling member's field
    const child = node[key]
    out[key] =
      child && typeof child === 'object' && !Array.isArray(child)
        ? projectSelectionOntoType(child as SelectorNode, f.type)
        : child
  }
  return out
}

/**
 * Fail loud when a merged sub-selection contains a field present on NONE of a
 * polymorphic field's member sub-types — the recursive analogue of the top-level
 * "field exists on no possible type" guard. Without it, per-member projection
 * would silently drop a genuinely-unknown field instead of surfacing the typo.
 */
function assertSelectionClaimed(
  node: SelectorNode,
  types: GraphQLObjectType[],
  path: string[]
): void {
  for (const key of Object.keys(node)) {
    if (key === '__args' || key === '__isList' || key === '__typename') continue
    const owners = types
      .map(t => t.getFields()[key])
      .filter((f): f is GraphQLField<any, any> => !!f)
    if (owners.length === 0) {
      throw new Error(
        `Field "${key}" does not exist on ${types.map(t => `"${t.name}"`).join(' | ')} ` +
          `(at "${path.join('.')}"). The useData selection references a field the ` +
          `schema doesn't have.`
      )
    }
    const child = node[key]
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      const childTypes = owners
        .map(f => getNamedType(f.type))
        .filter(isObjectType)
      if (childTypes.length) {
        assertSelectionClaimed(child as SelectorNode, childTypes, [...path, key])
      }
    }
  }
}

/** Dedup a union of TS type strings at top-level `|` atoms (bracket-aware, so a
 *  `|` inside `Array<… | null>` or an object literal isn't split). Order-stable. */
function dedupUnion(types: string[]): string {
  const atoms: string[] = []
  const seen = new Set<string>()
  for (const t of types) {
    for (const atom of splitTopLevelUnion(t)) {
      if (!seen.has(atom)) {
        seen.add(atom)
        atoms.push(atom)
      }
    }
  }
  return atoms.join(' | ')
}

function splitTopLevelUnion(ts: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < ts.length; i++) {
    const c = ts[i]
    if (c === '<' || c === '{' || c === '(' || c === '[') depth++
    else if (c === '>' || c === '}' || c === ')' || c === ']') depth--
    else if (depth === 0 && c === '|' && ts[i - 1] === ' ' && ts[i + 1] === ' ') {
      out.push(ts.slice(start, i - 1))
      start = i + 2
    }
  }
  out.push(ts.slice(start))
  return out.map(s => s.trim()).filter(Boolean)
}

/**
 * Compile a field returning an interface or union into inline fragments.
 *
 * The analyzer records a flat selection (`{ id, title, body }`); we partition it
 * against the schema: fields on the interface itself select directly, and each
 * remaining field is grouped under `... on ConcreteType { … }` for every possible
 * type that declares it. `__typename` discriminates. Result TS is merged-optional
 * (concrete fields become optional), so component code reads `node.title`
 * casually and branches on `node.__typename`.
 */
function compileInterfaceUnionField(
  ctx: Ctx,
  abstractType: GraphQLInterfaceType | GraphQLUnionType,
  node: SelectorNode,
  currentPath: string[]
): {sdl: string; ts: string} {
  const ifaceFields = isInterfaceType(abstractType)
    ? abstractType.getFields()
    : ({} as Record<string, GraphQLField<any, any>>)
  const possible = ctx.schema.getPossibleTypes(abstractType)

  const selections: string[] = []
  // member name → {types, optional}; rendered merged-optional.
  const members = new Map<string, {types: Set<string>; optional: boolean}>()
  const addMember = (name: string, ts: string, optional: boolean) => {
    const m = members.get(name)
    if (m) {
      m.types.add(ts)
      if (!optional) m.optional = false
    } else {
      members.set(name, {types: new Set([ts]), optional})
    }
  }

  const accessed = Object.keys(node).filter(
    k => k !== '__args' && k !== '__isList' && k !== '__typename'
  )
  const handled = new Set<string>()

  // 1. Fields on the interface itself → select directly (required in TS).
  for (const key of accessed) {
    const f = ifaceFields[key]
    if (!f) continue
    const {sdl, ts} = compileField(ctx, f, mergeBranches(node[key]), [...currentPath, key])
    selections.push(`${key}${sdl}`)
    addMember(key, ts, false)
    handled.add(key)
  }

  // 2. __typename discriminator (string-literal union of the possible types).
  selections.push('__typename')
  members.set('__typename', {
    types: new Set(possible.map(t => JSON.stringify(t.name))),
    optional: false
  })

  // A concrete field selected on ≥2 members with DIFFERENT types can't share one
  // response key — GraphQL rejects the merge. Alias those per member
  // (`status__pqAbs__Ticket: status`); the runtime un-aliases on normalize, so reads
  // stay `node.status`. Same-typed fields (e.g. `name: String` on both) merge fine
  // and are left un-aliased.
  //
  // The conflict key is the FULL type (`String(f.type)`), not just the named type:
  // GraphQL's SameResponseShape rule rejects a merge on differing nullability/list
  // wrappers too (`title: String!` vs `title: String`), even across
  // mutually-exclusive fragments. Keying on the named name alone missed those —
  // they compiled fine and 500'd at execution.
  const typesByField = new Map<string, Set<string>>()
  for (const type of possible) {
    const tFields = type.getFields()
    for (const key of accessed) {
      if (ifaceFields[key]) continue
      const f = tFields[key]
      if (!f) continue
      let s = typesByField.get(key)
      if (!s) typesByField.set(key, (s = new Set()))
      s.add(String(f.type))
    }
  }
  const conflicting = new Set(
    [...typesByField].filter(([, s]) => s.size > 1).map(([k]) => k)
  )

  // A shared field name whose OBJECT sub-type differs per member (e.g. `items`:
  // `[TimelineEntry!]!` vs `[NumberedEntry!]!`) is recorded by the analyzer as ONE
  // merged sub-selection — the union of every member's entry fields. Compiling that
  // union against each member throws on the sibling's fields (`marker` isn't on
  // `TimelineEntry`). So validate + partition the merged sub-selection per member
  // below; first fail loud on any sub-field present on NO member's sub-type, since
  // partitioning would otherwise drop it silently.
  for (const key of conflicting) {
    const memberSubTypes = possible
      .map(t => t.getFields()[key])
      .filter((f): f is GraphQLField<any, any> => !!f)
      .map(f => getNamedType(f.type))
    if (memberSubTypes.some(t => !isObjectType(t))) continue // only object sub-types
    const merged = mergeBranches(node[key])
    if (typeof merged === 'object') {
      assertSelectionClaimed(
        merged,
        memberSubTypes as GraphQLObjectType[],
        [...currentPath, key]
      )
    }
  }

  // 3. Per possible type: remaining accessed fields it declares.
  for (const type of possible) {
    const tFields = type.getFields()
    const fragSelections: string[] = []
    for (const key of accessed) {
      if (handled.has(key)) continue
      const f = tFields[key]
      if (!f) continue
      // For a conflicting field with an object sub-type, project the merged
      // sub-selection down to what THIS member's sub-type declares — dropping
      // sibling members' fields (already proven claimed by someone above).
      let sub = mergeBranches(node[key])
      const named = getNamedType(f.type)
      if (conflicting.has(key) && isObjectType(named) && typeof sub === 'object') {
        sub = projectSelectionOntoType(sub, f.type)
      }
      const {sdl, ts} = compileField(ctx, f, sub, [...currentPath, key])
      const alias = conflicting.has(key) ? `${key}__pqAbs__${type.name}: ` : ''
      fragSelections.push(`${alias}${key}${sdl}`)
      addMember(key, ts, true) // concrete field → optional
    }
    if (fragSelections.length === 0) continue
    fragSelections.push('__typename')
    if (tFields['id']) fragSelections.push('id')
    selections.push(`... on ${type.name} { ${fragSelections.join(' ')} }`)
  }

  // Fail loud on a field present on neither the interface nor any possible type.
  for (const key of accessed) {
    if (handled.has(key)) continue
    if (!possible.some(t => t.getFields()[key])) {
      throw new Error(
        `Field "${key}" does not exist on "${abstractType.name}" or any of its ` +
          `possible types. The selection references a field the schema doesn't have.`
      )
    }
  }

  // Dedup the union of per-member TS types at the top-level-atom level, so an
  // aliased field contributing `string` from one member and `string | null` from
  // another renders `string | null`, not `string | string | null`.
  const tsMembers = [...members.entries()].map(
    ([name, m]) =>
      `${name}${m.optional ? '?' : ''}: ${dedupUnion([...m.types])}`
  )
  return {
    sdl: `{ ${selections.join(' ')} }`,
    ts: `{ ${tsMembers.join('; ')} }`
  }
}

/**
 * Compile a mutation field: declare its arguments as runtime variables (named by
 * arg, supplied by `mutate(vars)`) and select the return object.
 */
function compileRuntimeArgsField(
  ctx: Ctx,
  field: GraphQLField<any, any>,
  node: SelectorNode | boolean
): {sdl: string; ts: string} {
  const argParts: string[] = []
  for (const arg of field.args) {
    ctx.runtimeVarDecls.push(`$${arg.name}: ${arg.type.toString()}`)
    argParts.push(`${arg.name}: $${arg.name}`)
  }
  const argSdl = argParts.length ? `(${argParts.join(', ')})` : ''

  const named = getNamedType(field.type)
  if (!isObjectType(named)) {
    // Scalar-returning mutation: nothing to select.
    return {sdl: argSdl, ts: applyWrappers(field.type, ctx.scalars[named.name] ?? 'any')}
  }
  const sub = compileObject(ctx, named, typeof node === 'object' ? node : {}, [
    field.name
  ])
  return {sdl: `${argSdl} ${sub.sdl}`, ts: applyWrappers(field.type, sub.ts)}
}

/** Compile a Relay connection field, injecting runtime pagination variables. */
function compileConnectionField(
  ctx: Ctx,
  field: GraphQLField<any, any>,
  node: SelectorNode | boolean
): {sdl: string; ts: string} {
  const named = getNamedType(field.type)
  if (!isObjectType(named)) {
    throw new Error(`Connection field "${field.name}" is not an object type.`)
  }

  const meta: ConnectionMeta = {path: ctx.connectionPath ?? [field.name]}
  const argParts: string[] = []
  // ALL connection args become runtime variables. Pagination ones (first/after/
  // last/before) are hook-managed (recorded in meta, prefixed `p_`); the rest
  // (e.g. `category`) are base args the hook supplies from the call's 2nd arg —
  // declared by their own name so they bind by key.
  for (const arg of field.args) {
    const isPagination = (PAGINATION_ARGS as readonly string[]).includes(arg.name)
    const varName = isPagination ? `p_${arg.name}` : arg.name
    ctx.connVarDecls.push(`$${varName}: ${arg.type.toString()}`)
    argParts.push(`${arg.name}: $${varName}`)
    if (isPagination) meta[arg.name as (typeof PAGINATION_ARGS)[number]] = varName
    // `anchor` is a base arg (bound by its own name), but the hook needs its var
    // name for the imperative `seekTo(id)` — record it like the pagination ones.
    else if (arg.name === 'anchor') meta.anchor = varName
  }
  ctx.connectionMeta = meta

  // Node selection comes from `conn.nodes[].x` and/or `conn.edges[].node.x`.
  // Everything else read on the connection — pageInfo/totalCount (always
  // selected below) and the hook controls (loadNext/loadPrev/jumpTo/
  // isLoadingMore) — is ignored, not treated as node fields.
  const nodeSelection = extractNodeSelection(node)

  const skeleton: SelectorNode = {
    totalCount: hasField(named, 'totalCount') ? true : undefined,
    startIndex: hasField(named, 'startIndex') ? true : undefined,
    pageInfo: {
      hasNextPage: true,
      hasPreviousPage: true,
      startCursor: true,
      endCursor: true
    },
    edges: {cursor: true, node: nodeSelection}
  }
  if (!skeleton.totalCount) delete skeleton.totalCount
  if (!skeleton.startIndex) delete skeleton.startIndex

  // Inner currentPath = the connection's own path, so edges/pageInfo never
  // re-match the connection path.
  const sub = compileObject(ctx, named, skeleton, ctx.connectionPath ?? [])

  // Splice the connection vars into the operation's variable declarations.
  const argSdl = argParts.length ? `(${argParts.join(', ')})` : ''
  return {sdl: `${argSdl} ${sub.sdl}`, ts: sub.ts}
}

/** Node sub-selection, from both `conn.nodes[].x` and `conn.edges[].node.x`. */
function extractNodeSelection(node: SelectorNode | boolean): SelectorNode {
  if (typeof node !== 'object') return {}
  let nodeSel: SelectorNode = {}
  const nodes = node.nodes
  if (nodes && typeof nodes === 'object' && !Array.isArray(nodes)) {
    nodeSel = mergeSelector(nodeSel, nodes as SelectorNode)
  }
  const edges = node.edges
  if (edges && typeof edges === 'object' && !Array.isArray(edges)) {
    const inner = (edges as SelectorNode).node
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      nodeSel = mergeSelector(nodeSel, inner as SelectorNode)
    }
  }
  return nodeSel
}

function hasField(type: GraphQLObjectType, name: string): boolean {
  return !!type.getFields()[name]
}

// ── TS type helpers ─────────────────────────────────────────────────────────

function enumTs(type: GraphQLEnumType): string {
  return type
    .getValues()
    .map(v => JSON.stringify(v.value))
    .join(' | ')
}

/** Apply list/nullable wrappers from a GraphQL type onto a TS inner type. */
function applyWrappers(type: GraphQLOutputType, innerTs: string): string {
  if (isNonNullType(type)) {
    return applyWrappersNonNull(type.ofType, innerTs)
  }
  // nullable
  if (isListType(type)) {
    return `Array<${applyWrappers(type.ofType, innerTs)}> | null`
  }
  return `${innerTs} | null`
}

function applyWrappersNonNull(type: GraphQLOutputType, innerTs: string): string {
  if (isListType(type)) {
    return `Array<${applyWrappers(type.ofType, innerTs)}>`
  }
  return innerTs
}

// ── selector merging (conditional branches) ──────────────────────────────────

function mergeBranches(
  value: SelectorNode | SelectorNode[] | boolean | string | undefined
): SelectorNode | boolean {
  if (value === true || value === undefined) return true
  if (typeof value === 'string') return true
  if (Array.isArray(value)) {
    let acc: SelectorNode = {}
    for (const branch of value) {
      if (branch && typeof branch === 'object') acc = mergeSelector(acc, branch)
    }
    return acc
  }
  return value
}

function mergeSelector(a: SelectorNode, b: SelectorNode): SelectorNode {
  const out: SelectorNode = {...a}
  for (const key of Object.keys(b)) {
    if (key === '__args') {
      if (out.__args === undefined) out.__args = b.__args
      continue
    }
    if (key === '__isList') {
      out.__isList = out.__isList || b.__isList
      continue
    }
    const av = out[key]
    const bv = b[key]
    if (av === undefined) {
      out[key] = bv
    } else if (
      av &&
      bv &&
      typeof av === 'object' &&
      typeof bv === 'object' &&
      !Array.isArray(av) &&
      !Array.isArray(bv)
    ) {
      out[key] = mergeSelector(av as SelectorNode, bv as SelectorNode)
    } else if (av === true) {
      out[key] = bv
    }
  }
  return out
}

// parseArgs is imported lazily to avoid a cycle in declaration emit.
import {parseArgs} from './parse-args'
function parseArgsOrThrow(raw: string, fieldName: string): Record<string, string> {
  const parsed = parseArgs(raw)
  if (parsed == null) {
    throw new Error(
      `Could not statically resolve arguments for field "${fieldName}": ` +
        `\`${raw}\`. Pass field arguments as an inline object literal, or use ` +
        `an explicit document (escape hatch).`
    )
  }
  return parsed
}
