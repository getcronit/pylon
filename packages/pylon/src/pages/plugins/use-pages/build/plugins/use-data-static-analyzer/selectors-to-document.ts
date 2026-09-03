import {
  allScalarSelectors,
  compileOperation,
  documentId,
  mutationResultSelectors,
  type CompiledOperation,
  type SelectorNode as QuerySelectorNode
} from '../../../../../../query/build'
import {getNamedType, type GraphQLObjectType, type GraphQLSchema} from 'graphql'
import type {SelectorNode} from './analyze'

/**
 * Lower an analyzer selector tree into the source the analyzer injects:
 *
 *   1. a module-scope `doc({...})` call (the compiled GraphQL operation + id), and
 *   2. a call-site variables thunk `() => ({ v0: <expr>, ... })`.
 *
 * This replaces `generatePrepare` (the gqty prepare closure). The shape lives in
 * the document at module scope — so it can never reference component locals and
 * can never hit a temporal dead zone. Only the variables thunk touches locals,
 * and it is evaluated lazily at first field access (in JSX, below the `const`s).
 */
export interface LoweredQuery {
  /** Identifier for the module-scope const, e.g. "__pylonDoc_Page_0". */
  docConstName: string
  /** Source of the `const __pylonDoc_… = doc({...})` declaration. */
  docDeclaration: string
  /** Source of the variables thunk, or undefined when the op has no variables. */
  variablesThunk?: string
  compiled: CompiledOperation
}

export interface LowerOptions {
  /** Emit `@inContext(locale: $__locale)` — set when `usePages({i18n})` is configured. */
  inContext?: boolean
  scalarTypes?: Record<string, string>
  /** Compile as a Relay connection rooted at this field path. */
  connection?: {path: string[]}
  /** Identifier for the `doc` factory in the emitted declaration (default "doc"). */
  docFnName?: string
  /** Operation type — "query" (default) or "mutation". */
  operation?: 'query' | 'mutation'
  /** op: expand bare-object returns to allScalars (see compile's CompileOptions). */
  fillObjectLeaves?: boolean
}

export function lowerQuery(
  schema: GraphQLSchema,
  selectors: SelectorNode,
  operationName: string,
  constName: string,
  options: LowerOptions = {}
): LoweredQuery {
  const compiled = compileOperation(
    schema,
    selectors as unknown as QuerySelectorNode,
    {
      name: operationName,
      operation: options.operation,
      scalarTypes: options.scalarTypes,
      connection: options.connection,
      fillObjectLeaves: options.fillObjectLeaves,
      inContext: options.inContext
    }
  )

  const id = documentId(compiled.body)
  const docFn = options.docFnName ?? 'doc'
  const connectionMeta = compiled.connection
    ? `,\n  connection: ${JSON.stringify(compiled.connection)}`
    : ''
  const argAliasesMeta = compiled.argAliases
    ? `,\n  argAliases: ${JSON.stringify(compiled.argAliases)}`
    : ''
  // Args-inclusive entity storage keys → keeps `field(A)` / `field(B)` distinct on one entity.
  const argSlotsMeta = compiled.argSlots
    ? `,\n  argSlots: ${JSON.stringify(compiled.argSlots)}`
    : ''
  // Tells the runtime client to supply `$__locale` before it hashes the variables.
  const inContextMeta = compiled.inContext ? `,\n  inContext: true` : ''
  // Completeness shape → the runtime read gate (never renders a partial op).
  const shapeMeta = compiled.shape
    ? `,\n  shape: ${JSON.stringify(compiled.shape)}`
    : ''

  const docDeclaration =
    `const ${constName} = ${docFn}<${compiled.resultType}>({\n` +
    `  id: ${JSON.stringify(id)},\n` +
    `  name: ${JSON.stringify(compiled.name)},\n` +
    `  body: ${JSON.stringify(compiled.body)}${connectionMeta}${argAliasesMeta}${argSlotsMeta}${inContextMeta}${shapeMeta}\n` +
    `})`

  let variablesThunk: string | undefined
  if (compiled.variables.length > 0) {
    const members = compiled.variables
      .map(v => `${v.name}: ${v.expr}`)
      .join(', ')
    variablesThunk = `() => ({${members}})`
  }

  return {docConstName: constName, docDeclaration, variablesThunk, compiled}
}

/**
 * Lower a `useMutation(m => m.field)` selector into a compiled mutation document.
 *
 * v1 selection = allScalars(ReturnType) ∪ {id, __typename}. The analyzed nested
 * trigger-return reads (`analyze(triggerReturn)`) can be merged in here later;
 * full scalars already give cache-consistent updates for the common case.
 */
/** Deep-merge two selector trees (b's object subtrees win over a's `true`). */
function mergeSelectorNodes(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {...a}
  for (const [key, bv] of Object.entries(b)) {
    const av = out[key]
    if (
      av &&
      bv &&
      typeof av === 'object' &&
      typeof bv === 'object' &&
      !Array.isArray(av) &&
      !Array.isArray(bv)
    ) {
      out[key] = mergeSelectorNodes(
        av as Record<string, unknown>,
        bv as Record<string, unknown>
      )
    } else if (av === undefined || av === true) {
      out[key] = bv
    }
  }
  return out
}

/**
 * Prune a heuristic selector tree (from `analyze(triggerReturn)`) to fields that
 * actually exist on the schema type. Trigger-return tracing is name-based: it can
 * pick up reads from sibling handlers that reuse the result variable name (e.g.
 * several `const res = await otherTrigger()` in one component). Those false
 * positives must be dropped rather than compiled — otherwise the build fails on a
 * field the payload doesn't have. Real reads (e.g. `userErrors { message }`) and
 * `__typename` survive; `allScalars` already covers scalar fields independently,
 * so this is purely a safety filter on the additive nested selection.
 */
function pruneSelectorToSchema(
  schema: GraphQLSchema,
  typeName: string,
  sel: Record<string, unknown>
): Record<string, unknown> {
  const type = schema.getType(typeName)
  const fields =
    type && 'getFields' in type
      ? (type as GraphQLObjectType).getFields()
      : null
  if (!fields) return {}
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(sel)) {
    if (key === '__typename') {
      out[key] = val
      continue
    }
    const f = fields[key]
    if (!f) continue // heuristic false positive — not a real field on this type
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = pruneSelectorToSchema(
        schema,
        getNamedType(f.type).name,
        val as Record<string, unknown>
      )
    } else {
      out[key] = val
    }
  }
  return out
}

export function lowerMutation(
  schema: GraphQLSchema,
  fieldName: string,
  operationName: string,
  constName: string,
  options: {
    scalarTypes?: Record<string, string>
    docFnName?: string
    /** Emit `@inContext(locale: $__locale)` — mutations are localized too (a returned
     *  record's name, a validation message), so they carry it as queries do. */
    inContext?: boolean
    /** analyze(triggerReturn): nested/relation selectors read off the result. */
    nested?: SelectorNode
  } = {}
): LoweredQuery {
  const mutationType = schema.getMutationType()
  const field = mutationType?.getFields()[fieldName]
  if (!field) {
    throw new Error(
      `Mutation field "${fieldName}" does not exist. ` +
        `useMutation(m => m.${fieldName}) references an unknown mutation.`
    )
  }
  const returnTypeName = getNamedType(field.type).name
  // selection = allScalars(ReturnType) ∪ prune(analyze(triggerReturn)) ∪ {id, __typename}
  // The trigger-return reads are heuristic, so prune them to real schema fields
  // before merging (drops cross-handler false positives instead of failing build).
  const returnSelection = mergeSelectorNodes(
    // Recurse one level (payload scalars + each object/list field's scalars +id)
    // so the returned entity normalizes and updates the cache by default — the
    // analyzer's trigger-return reads add deeper relations on top.
    mutationResultSelectors(schema, returnTypeName),
    pruneSelectorToSchema(
      schema,
      returnTypeName,
      (options.nested ?? {}) as Record<string, unknown>
    )
  )
  const selectors = {
    [fieldName]: returnSelection
  } as unknown as QuerySelectorNode

  const compiled = compileOperation(schema, selectors, {
    name: operationName,
    operation: 'mutation',
    inContext: options.inContext,
    runtimeArgsField: fieldName,
    scalarTypes: options.scalarTypes
  })

  const id = documentId(compiled.body)
  const docFn = options.docFnName ?? 'doc'
  const docDeclaration =
    `const ${constName} = ${docFn}<${compiled.resultType}>({\n` +
    `  id: ${JSON.stringify(id)},\n` +
    `  name: ${JSON.stringify(compiled.name)},\n` +
    `  rootField: ${JSON.stringify(fieldName)},\n` +
    `  body: ${JSON.stringify(compiled.body)}` +
    (compiled.inContext ? `,\n  inContext: true` : '') +
    `\n})`

  return {docConstName: constName, docDeclaration, variablesThunk: undefined, compiled}
}
