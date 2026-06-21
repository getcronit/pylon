import {
  allScalarSelectors,
  compileOperation,
  documentId,
  type CompiledOperation,
  type SelectorNode as QuerySelectorNode
} from '@getcronit/pylon-query/build'
import {getNamedType, type GraphQLSchema} from 'graphql'
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
  scalarTypes?: Record<string, string>
  /** Compile as a Relay connection rooted at this field path. */
  connection?: {path: string[]}
  /** Identifier for the `doc` factory in the emitted declaration (default "doc"). */
  docFnName?: string
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
      scalarTypes: options.scalarTypes,
      connection: options.connection
    }
  )

  const id = documentId(compiled.body)
  const docFn = options.docFnName ?? 'doc'
  const connectionMeta = compiled.connection
    ? `,\n  connection: ${JSON.stringify(compiled.connection)}`
    : ''

  const docDeclaration =
    `const ${constName} = ${docFn}<${compiled.resultType}>({\n` +
    `  id: ${JSON.stringify(id)},\n` +
    `  name: ${JSON.stringify(compiled.name)},\n` +
    `  body: ${JSON.stringify(compiled.body)}${connectionMeta}\n` +
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
export function lowerMutation(
  schema: GraphQLSchema,
  fieldName: string,
  operationName: string,
  constName: string,
  options: {scalarTypes?: Record<string, string>; docFnName?: string} = {}
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
  const selectors = {
    [fieldName]: allScalarSelectors(schema, returnTypeName)
  } as unknown as QuerySelectorNode

  const compiled = compileOperation(schema, selectors, {
    name: operationName,
    operation: 'mutation',
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
    `  body: ${JSON.stringify(compiled.body)}\n` +
    `})`

  return {docConstName: constName, docDeclaration, variablesThunk: undefined, compiled}
}
