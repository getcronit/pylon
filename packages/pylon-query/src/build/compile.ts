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
  type GraphQLField,
  type GraphQLInterfaceType,
  type GraphQLOutputType,
  type GraphQLUnionType
} from 'graphql'
import type {ConnectionMeta} from '../runtime/doc'

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

export interface CompileOptions {
  /** Operation name. */
  name: string
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
}

export interface CompiledOperation {
  name: string
  /** GraphQL operation source sent over the wire. */
  body: string
  /** TS type literal for the result root, e.g. "{ me: { name: string } }". */
  resultType: string
  /** Variables whose values come from the call site (the thunk). */
  variables: CompiledVariable[]
  /** Present iff `options.connection` was given. */
  connection?: ConnectionMeta
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

const PAGINATION_ARGS = ['first', 'after', 'last', 'before'] as const

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
    connectionMeta: undefined
  }

  const forceConn =
    options.connection && options.connection.path.length === 1
      ? options.connection.path[0]
      : undefined

  // Root operation type is not an entity → no __typename/id injection.
  const {sdl, ts} = compileObject(ctx, rootType, selectors, forceConn, false)

  const allDecls = [
    ...ctx.variables.map(v => `$${v.name}: ${v.gqlType}`),
    ...ctx.runtimeVarDecls,
    ...ctx.connVarDecls
  ]
  const varDecls = allDecls.length ? `(${allDecls.join(', ')})` : ''

  const body = `${operation} ${options.name}${varDecls} ${sdl}`

  return {
    name: options.name,
    body,
    resultType: ts,
    variables: ctx.variables.map(v => ({name: v.name, expr: v.expr})),
    connection: ctx.connectionMeta
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
  connectionMeta?: ConnectionMeta
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
  forceConnectionField?: string,
  injectMeta = true
): {sdl: string; ts: string} {
  const fields = type.getFields()
  const selections: string[] = []
  const tsMembers: string[] = []
  const selected = new Set<string>()

  for (const key of Object.keys(node)) {
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

    const value = node[key]
    const merged = mergeBranches(value)

    if (forceConnectionField && key === forceConnectionField) {
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

    const {sdl, ts} = compileField(ctx, field, merged)
    selections.push(`${key}${sdl}`)
    tsMembers.push(`${key}: ${ts}`)
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
  node: SelectorNode | boolean
): {sdl: string; ts: string} {
  const argsSdl =
    typeof node === 'object' ? compileArgs(ctx, field, node.__args) : ''
  const named = getNamedType(field.type)

  let innerSdl = ''
  let innerTs: string

  if (isScalarType(named)) {
    innerTs = ctx.scalars[named.name] ?? 'any'
  } else if (isEnumType(named)) {
    innerTs = enumTs(named)
  } else if (isObjectType(named)) {
    if (typeof node !== 'object') {
      // Object field selected as a leaf — keep valid with __typename.
      innerSdl = ' { __typename }'
      innerTs = '{ __typename?: string }'
    } else {
      const sub = compileObject(ctx, named, node)
      innerSdl = ` ${sub.sdl}`
      innerTs = sub.ts
    }
  } else if (isInterfaceType(named) || isUnionType(named)) {
    const sub =
      typeof node === 'object'
        ? compileInterfaceUnionField(ctx, named, node)
        : {sdl: '{ __typename }', ts: '{ __typename?: string }'}
    innerSdl = ` ${sub.sdl}`
    innerTs = sub.ts
  } else {
    innerSdl = ' { __typename }'
    innerTs = '{ __typename?: string }'
  }

  return {
    sdl: `${argsSdl}${innerSdl}`,
    ts: applyWrappers(field.type, innerTs)
  }
}

/** Build the `(arg: $vN, …)` SDL and register variables for a field's args. */
function compileArgs(
  ctx: Ctx,
  field: GraphQLField<any, any>,
  rawArgs: string | undefined
): string {
  if (rawArgs == null) return ''
  // Lazy import to keep the parser self-contained.
  const parsed = parseArgsOrThrow(rawArgs, field.name)
  const keys = Object.keys(parsed)
  if (keys.length === 0) return ''

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
    parts.push(`${argName}: $${varName}`)
  }
  return `(${parts.join(', ')})`
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
  node: SelectorNode
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
    const {sdl, ts} = compileField(ctx, f, mergeBranches(node[key]))
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

  // 3. Per possible type: remaining accessed fields it declares.
  for (const type of possible) {
    const tFields = type.getFields()
    const fragSelections: string[] = []
    for (const key of accessed) {
      if (handled.has(key)) continue
      const f = tFields[key]
      if (!f) continue
      const {sdl, ts} = compileField(ctx, f, mergeBranches(node[key]))
      fragSelections.push(`${key}${sdl}`)
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

  const tsMembers = [...members.entries()].map(
    ([name, m]) => `${name}${m.optional ? '?' : ''}: ${[...m.types].join(' | ')}`
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
  const sub = compileObject(ctx, named, typeof node === 'object' ? node : {})
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

  const meta: ConnectionMeta = {path: [field.name]}
  const argParts: string[] = []
  for (const argName of PAGINATION_ARGS) {
    const argDef = field.args.find(a => a.name === argName)
    if (!argDef) continue
    const varName = `p_${argName}`
    // Connection vars are declared on the operation but carry no call-site
    // expr — the hook supplies them at runtime by these names.
    ctx.connVarDecls.push(`$${varName}: ${argDef.type.toString()}`)
    argParts.push(`${argName}: $${varName}`)
    meta[argName] = varName
  }
  ctx.connectionMeta = meta

  // Merge a default connection skeleton with the analyzer's node selection.
  const nodeSel: SelectorNode =
    typeof node === 'object' && node.edges && typeof node.edges === 'object'
      ? (node as SelectorNode)
      : ({
          edges: {node: typeof node === 'object' ? node : {}}
        } as SelectorNode)

  const skeleton: SelectorNode = {
    totalCount: hasField(named, 'totalCount') ? true : undefined,
    pageInfo: {
      hasNextPage: true,
      hasPreviousPage: true,
      startCursor: true,
      endCursor: true
    },
    edges: mergeSelector(
      {cursor: true, node: getNodeSelection(nodeSel)},
      typeof nodeSel.edges === 'object'
        ? (nodeSel.edges as SelectorNode)
        : {}
    )
  }
  if (!skeleton.totalCount) delete skeleton.totalCount

  const sub = compileObject(ctx, named, skeleton)

  // Splice the connection vars into the operation's variable declarations.
  const argSdl = argParts.length ? `(${argParts.join(', ')})` : ''
  return {sdl: `${argSdl} ${sub.sdl}`, ts: sub.ts}
}

function getNodeSelection(connSel: SelectorNode): SelectorNode {
  const edges = connSel.edges
  if (edges && typeof edges === 'object' && (edges as SelectorNode).node) {
    const node = (edges as SelectorNode).node
    if (typeof node === 'object') return node as SelectorNode
  }
  return {}
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
