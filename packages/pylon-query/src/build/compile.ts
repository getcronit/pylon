import {
  getNamedType,
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLSchema,
  isEnumType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  type GraphQLField,
  type GraphQLOutputType
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
  /** GraphQL scalar name → TS type (e.g. {Number: "number"}). */
  scalarTypes?: Record<string, string>
  /**
   * Compile as a Relay connection: force pagination variables on the field at
   * this path (length-1, top-level field) and select the full connection shape.
   */
  connection?: {path: string[]}
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
  const queryType = schema.getQueryType()
  if (!queryType) throw new Error('Schema has no Query type')

  const ctx: Ctx = {
    schema,
    scalars: {...DEFAULT_SCALARS, ...(options.scalarTypes ?? {})},
    varCount: 0,
    variables: [],
    connVarDecls: [],
    connectionOpt: options.connection,
    connectionMeta: undefined
  }

  const forceConn =
    options.connection && options.connection.path.length === 1
      ? options.connection.path[0]
      : undefined

  const {sdl, ts} = compileObject(ctx, queryType, selectors, forceConn)

  const allDecls = [
    ...ctx.variables.map(v => `$${v.name}: ${v.gqlType}`),
    ...ctx.connVarDecls
  ]
  const varDecls = allDecls.length ? `(${allDecls.join(', ')})` : ''

  const body = `query ${options.name}${varDecls} ${sdl}`

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
  connectionOpt?: {path: string[]}
  connectionMeta?: ConnectionMeta
}

function allocVar(ctx: Ctx, gqlType: string, expr: string): string {
  const name = `v${ctx.varCount++}`
  ctx.variables.push({name, gqlType, expr})
  return name
}

/** Compile a selection set against an object type. Returns SDL + TS literal. */
function compileObject(
  ctx: Ctx,
  type: GraphQLObjectType,
  node: SelectorNode,
  forceConnectionField?: string
): {sdl: string; ts: string} {
  const fields = type.getFields()
  const selections: string[] = []
  const tsMembers: string[] = []

  for (const key of Object.keys(node)) {
    if (key === '__args' || key === '__isList') continue
    if (key === '__typename') {
      selections.push('__typename')
      tsMembers.push('__typename?: string')
      continue
    }

    const field = fields[key]
    if (!field) {
      throw new Error(
        `Field "${key}" does not exist on type "${type.name}". ` +
          `The useData selection references a field the schema doesn't have.`
      )
    }

    const value = node[key]
    const merged = mergeBranches(value)

    if (forceConnectionField && key === forceConnectionField) {
      const {sdl, ts} = compileConnectionField(ctx, field, merged)
      selections.push(`${key}${sdl}`)
      tsMembers.push(`${key}: ${ts}`)
      continue
    }

    const {sdl, ts} = compileField(ctx, field, merged)
    selections.push(`${key}${sdl}`)
    tsMembers.push(`${key}: ${ts}`)
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
  } else {
    // interface/union — not fully supported yet; select __typename.
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
