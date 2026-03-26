import {Context, getContext, getResolveInfo} from '@getcronit/pylon'
import {delegateToSchema, Transform} from '@graphql-tools/delegate'
import {buildHTTPExecutor} from '@graphql-tools/executor-http'
import {schemaFromExecutor, wrapSchema} from '@graphql-tools/wrap'
import {
  ArgumentNode,
  FieldNode,
  getNamedType,
  isEnumType,
  Kind,
  OperationTypeNode,
  SelectionNode,
  SelectionSetNode,
  TypeInfo,
  ValueNode,
  visit,
  visitWithTypeInfo
} from 'graphql'

type Primitive =
  | string
  | number
  | boolean
  | symbol
  | bigint
  | undefined
  | null
  | Date

/**
 * Recursively maps a GraphQL return type to a selection map for the `needs` object.
 * Allows boolean flags for selection and a special `__args` property for nested arguments.
 */
export type NeedsMap<T> = T extends Primitive
  ? boolean
  : // Unwrap function signatures so we can select fields on their return type
    T extends (...args: any[]) => infer Ret
    ? NeedsMap<Awaited<Ret>>
    : T extends Array<infer U>
      ? NeedsMap<U>
      : {
          [K in keyof T]?: NeedsMap<T[K]> | boolean
        } & {__args?: Record<string, any>}

/**
 * Maps over the properties of the resolved type within the registry.
 * Intercepting the lookup at the property level mitigates TS2589
 * (Type instantiation is excessively deep and possibly infinite) during recursive type inference.
 */
type MapValue<V, P, R> = V extends Primitive
  ? V
  : V extends Array<infer U>
    ? Array<PatchSchema<U, P, R>>
    : V extends {__typename: infer Name}
      ? Name extends keyof P
        ? P[Name & keyof P] extends (...args: any) => infer Res
          ? {[Prop in keyof Res]: PatchSchema<Res[Prop], P, R>}
          : never
        : {[Prop in keyof V]: PatchSchema<V[Prop], P, R>}
      : {[Prop in keyof V]: PatchSchema<V[Prop], P, R>}

type MappedRegistry<R, P> = {
  [K in keyof R]: MapValue<R[K], P, R>
}

type PatchSchema<T, P, R> = T extends Primitive
  ? T
  : // Preserve resolver function signatures & args, and patch their return types.
    T extends (...args: infer Args) => infer Ret
    ? (
        ...args: Args
      ) => Ret extends Promise<any>
        ? Promise<PatchSchema<Awaited<Ret>, P, R>>
        : PatchSchema<Awaited<Ret>, P, R>
    : // Recursively apply PatchSchema to array element types.
      T extends Array<infer U>
      ? Array<PatchSchema<U, P, R>>
      : // Route schema objects through MappedRegistry via __typename to maintain
        // type safety across graph boundaries without triggering circular reference limits.
        T extends {__typename: infer Name}
        ? Name extends keyof R
          ? MappedRegistry<R, P>[Name & keyof R]
          : {[K in keyof T]: PatchSchema<T[K], P, R>}
        : T extends object
          ? {[K in keyof T]: PatchSchema<T[K], P, R>}
          : T

// Implements a Promise-based cache to synchronize remote schema introspection
// and mitigate race conditions during concurrent initialization.
const schemaCache = new Map<string, Promise<any>>()

export interface GatewayContext<TRegistry extends {delegate: any; types: any}> {
  delegate: <
    K extends keyof TRegistry['delegate'],
    TNeeds extends NeedsMap<TRegistry['delegate'][K]['return']> = NeedsMap<
      TRegistry['delegate'][K]['return']
    >
  >(
    key: K,
    ...opts: {} extends TRegistry['delegate'][K]['args']
      ? [options?: {args?: TRegistry['delegate'][K]['args']; needs?: TNeeds}]
      : [options: {args: TRegistry['delegate'][K]['args']; needs?: TNeeds}]
  ) => Promise<TRegistry['delegate'][K]['return']> // We return the base type, patches are applied downstream
}

// --- AST Builder Utilities ---

function astFromJSValue(value: any): ValueNode {
  if (value === null || value === undefined) {
    return {kind: Kind.NULL}
  }
  if (typeof value === 'string') {
    return {kind: Kind.STRING, value}
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? {kind: Kind.INT, value: String(value)}
      : {kind: Kind.FLOAT, value: String(value)}
  }
  if (typeof value === 'boolean') {
    return {kind: Kind.BOOLEAN, value}
  }
  if (Array.isArray(value)) {
    return {
      kind: Kind.LIST,
      values: value.map(astFromJSValue)
    }
  }
  if (typeof value === 'object') {
    return {
      kind: Kind.OBJECT,
      fields: Object.entries(value)
        // Filter out undefined keys so they aren't sent to the remote graph
        .filter(([_, val]) => val !== undefined)
        .map(([key, val]) => ({
          kind: Kind.OBJECT_FIELD,
          name: {kind: Kind.NAME, value: key},
          value: astFromJSValue(val)
        }))
    }
  }

  // Fallback
  return {kind: Kind.STRING, value: String(value)}
}

function buildSelectionsFromNeeds(needs: Record<string, any>): SelectionNode[] {
  const selections: SelectionNode[] = []

  for (const [key, value] of Object.entries(needs)) {
    if (key === '__args' || !value) continue

    let selectionSet: SelectionSetNode | undefined = undefined
    let argsNodes: ArgumentNode[] | undefined = undefined

    if (typeof value === 'object') {
      const nestedSelections = buildSelectionsFromNeeds(value)

      if (nestedSelections.length > 0) {
        selectionSet = {
          kind: Kind.SELECTION_SET,
          selections: nestedSelections
        }
      }

      if (value.__args) {
        argsNodes = Object.entries(value.__args).map(
          ([argName, argVal]): ArgumentNode => ({
            kind: Kind.ARGUMENT,
            name: {kind: Kind.NAME, value: argName},
            value: astFromJSValue(argVal)
          })
        )
      }
    }

    selections.push({
      kind: Kind.FIELD,
      name: {kind: Kind.NAME, value: key},
      ...(selectionSet ? {selectionSet} : {}),
      ...(argsNodes ? {arguments: argsNodes} : {})
    } as FieldNode)
  }

  return selections
}

// --- Transforms ---

class InjectNeedsTransform implements Transform {
  constructor(private needs?: Record<string, any>) {}

  transformRequest(originalRequest: any) {
    if (!this.needs || Object.keys(this.needs).length === 0) {
      return originalRequest
    }

    const needsSelections = buildSelectionsFromNeeds(this.needs)
    let rootFieldFound = false

    const document = visit(originalRequest.document, {
      Field(node) {
        if (!rootFieldFound && node.selectionSet) {
          rootFieldFound = true

          const existingNames = new Set(
            node.selectionSet.selections
              .filter(s => s.kind === Kind.FIELD)
              .map((s: any) => s.name.value)
          )

          const mergedSelections = [...node.selectionSet.selections]

          for (const selection of needsSelections) {
            if (
              selection.kind === Kind.FIELD &&
              !existingNames.has(selection.name.value)
            ) {
              mergedSelections.push(selection)
            }
          }

          return {
            ...node,
            selectionSet: {
              ...node.selectionSet,
              selections: mergedSelections
            }
          }
        }
      }
    })

    return {...originalRequest, document}
  }
}

class InlineArgsTransform implements Transform {
  constructor(private wrapperArgs: Record<string, any>) {}

  transformRequest(originalRequest: any, delegationContext: any) {
    // 1. Parse the root args provided by your JS wrapper (if any)
    const rootInlineArguments =
      this.wrapperArgs && Object.keys(this.wrapperArgs).length > 0
        ? Object.entries(this.wrapperArgs)
            .filter(([_, val]) => val !== undefined)
            // Add the explicit ArgumentNode return type here!
            .map(
              ([key, value]): ArgumentNode => ({
                kind: Kind.ARGUMENT,
                name: {kind: Kind.NAME, value: key},
                value: astFromJSValue(value)
              })
            )
        : []

    const targetFieldName = delegationContext.fieldName
    let targetFieldFound = false

    // graphql-tools safely extracts nested variables into this object
    const variables = originalRequest.variables || {}

    let inlineDocument = visit(originalRequest.document, {
      // A. Inject our wrapper args into the ROOT field
      Field(node) {
        if (!targetFieldFound && node.name.value === targetFieldName) {
          targetFieldFound = true

          const existingArgs = node.arguments || []
          const mergedArgs = [...existingArgs]

          for (const newArg of rootInlineArguments) {
            const existingIdx = mergedArgs.findIndex(
              a => a.name.value === newArg.name.value
            )
            if (existingIdx > -1) mergedArgs[existingIdx] = newArg
            else mergedArgs.push(newArg)
          }

          return {...node, arguments: mergedArgs}
        }
      },

      // B. PRUNE missing arguments entirely
      Argument(node) {
        if (node.value.kind === Kind.VARIABLE) {
          const varName = node.value.name.value
          if (!(varName in variables) || variables[varName] === undefined) {
            return null // Deletes `first: $a70fde` from the AST
          }
        }
      },

      // C. PRUNE missing input object fields entirely (e.g. filters: { status: $missing })
      ObjectField(node) {
        if (node.value.kind === Kind.VARIABLE) {
          const varName = node.value.name.value
          if (!(varName in variables) || variables[varName] === undefined) {
            return null // Deletes the field from the input object
          }
        }
      },

      // D. Inline all surviving variables (and safely fallback to NullNode just in case)
      Variable(node) {
        const varName = node.name.value
        return astFromJSValue(variables[varName])
      },

      // E. Wipe variable definitions
      OperationDefinition(node) {
        return {...node, variableDefinitions: []}
      }
    })

    // 3. Run the TypeInfo pass over the FULL document.
    // This ensures both root and nested string AST nodes are correctly coerced to Enums!
    const typeInfo = new TypeInfo(delegationContext.targetSchema)
    inlineDocument = visit(
      inlineDocument,
      visitWithTypeInfo(typeInfo, {
        StringValue(node) {
          const inputType = typeInfo.getInputType()
          if (inputType) {
            const namedType = getNamedType(inputType)
            if (isEnumType(namedType)) {
              return {kind: Kind.ENUM, value: node.value}
            }
          }
        }
      })
    )

    return {
      ...originalRequest,
      document: inlineDocument,
      variables: {} // Wipe the payload, we don't need it anymore!
    }
  }
}

class PylonPatchTransform<TPatch> implements Transform {
  constructor(
    private patches: TPatch,
    private api: any
  ) {}

  // Injects __typename into all selection sets via AST traversal to ensure
  // deterministic resolution of interface/union types for downstream runtime transformations.
  transformRequest(originalRequest: any) {
    const document = visit(originalRequest.document, {
      SelectionSet(node) {
        const hasTypename = node.selections.some(
          s => s.kind === Kind.FIELD && s.name.value === '__typename'
        )
        if (!hasTypename) {
          return {
            ...node,
            selections: [
              ...node.selections,
              {
                kind: Kind.FIELD,
                name: {kind: Kind.NAME, value: '__typename'}
              }
            ]
          }
        }
      }
    })
    return {...originalRequest, document}
  }

  // Intercepts the execution phase to recursively apply registered patches to the payload.
  transformResult(originalResult: any) {
    return this.applyTransforms(originalResult)
  }

  private applyTransforms(data: any): any {
    if (!data || typeof data !== 'object') return data
    if (Array.isArray(data)) return data.map(item => this.applyTransforms(item))

    const processedData = {...data}
    for (const key in processedData) {
      processedData[key] = this.applyTransforms(processedData[key])
    }

    const typeName = data.__typename
    const patchFn = (this.patches as any)[typeName]
    if (patchFn) {
      const patchedData = patchFn(processedData, this.api)

      // Safely merge the patched result WITH the original processedData.
      // This ensures that any dynamically aliased keys (e.g., 'b5c5d1')
      // are strictly preserved, even if the patch function forgets (or chooses not) to spread them.
      if (
        patchedData &&
        typeof patchedData === 'object' &&
        !Array.isArray(patchedData)
      ) {
        return {
          ...processedData,
          ...patchedData
        }
      }

      return patchedData
    }

    return processedData
  }
}

// --- Main Gateway Class ---

class PylonGateway<
  TRegistry extends {delegate: any; types: any},
  TPatch extends Record<string, (data: any, api: any) => any>
> {
  private apiContext: GatewayContext<TRegistry>

  constructor(
    private config: {
      url: string
      headers?: (ctx: any) => Record<string, string>
      patches: TPatch
    }
  ) {
    this.apiContext = {
      delegate: this.delegate.bind(this) as any
    }
  }

  public async delegate<
    K extends keyof TRegistry['delegate'],
    TNeeds extends NeedsMap<TRegistry['delegate'][K]['return']> = NeedsMap<
      TRegistry['delegate'][K]['return']
    >
  >(
    key: K,
    ...opts: {} extends TRegistry['delegate'][K]['args']
      ? [options?: {args?: TRegistry['delegate'][K]['args']; needs?: TNeeds}]
      : [options: {args: TRegistry['delegate'][K]['args']; needs?: TNeeds}]
  ): Promise<
    PatchSchema<TRegistry['delegate'][K]['return'], TPatch, TRegistry['types']>
  > {
    const {info} = getResolveInfo()
    const ctx = getContext()

    if (!info || !ctx) throw new Error('Pylon context missing')

    // Extract args and needs from the unified options object
    const options = opts[0] as {args?: any; needs?: any} | undefined
    const args = options?.args || {}
    const needs = options?.needs

    const [rootType, fieldName] = String(key).split('.')

    if (!rootType || !fieldName) {
      throw new Error(
        `Invalid delegate key format: ${String(key)}. Expected "Operation.field"`
      )
    }

    const operationMap: Record<string, OperationTypeNode> = {
      Query: OperationTypeNode.QUERY,
      Mutation: OperationTypeNode.MUTATION,
      Subscription: OperationTypeNode.SUBSCRIPTION
    }

    const operation = operationMap[rootType]

    // Validate operation type against supported GraphQL root nodes.
    if (!operation) {
      throw new Error(
        `Unsupported operation type "${rootType}" in key "${String(key)}"`
      )
    }

    if (!schemaCache.has(this.config.url)) {
      const executor = buildHTTPExecutor({
        endpoint: this.config.url,
        headers: r => ({
          ...(this.config.headers ? this.config.headers(r?.context) : {})
        })
      })

      const schemaPromise = schemaFromExecutor(executor).then(schema =>
        wrapSchema({schema, executor})
      )
      schemaCache.set(this.config.url, schemaPromise)
    }

    const schema = await schemaCache.get(this.config.url)

    const result = await delegateToSchema({
      schema,
      operation: operation,
      fieldName: fieldName,
      args: args,
      context: ctx,
      info,
      transforms: [
        new InjectNeedsTransform(needs), // Injects requested AST fields
        new InlineArgsTransform(args), // Injects arguments into the AST
        new PylonPatchTransform(this.config.patches, this.apiContext)
      ]
    })

    return result as any
  }
}

/**
 * Instantiates a factory for configuring a strongly-typed PylonGateway.
 *
 * Utilizes a generated type registry (`TRegistry`) mapping remote GraphQL typenames
 * to TypeScript interfaces, guaranteeing end-to-end type safety for configurations,
 * schema patches, and delegated execution payloads.
 *
 * @template TRegistry - Type map correlating GraphQL typenames to local TypeScript definitions.
 * @returns Gateway configuration interface.
 *
 * @example
 *
 * // Provision remote schema via CLI: pylon pull <url> -n <name>
 *
 * ```typescript
 * import { createGateway } from '@getcronit/pylon';
 * import { RemoteRegistry } from './generated/remote';
 *
 * const gateway = createGateway<RemoteRegistry>().configure({
 * url: '[https://api.example.com/graphql](https://api.example.com/graphql)',
 * headers: (ctx) => ({ Authorization: ctx.token }),
 * patches: {
 * User: (data, api) => ({ ...data, fullName: `${data.firstName} ${data.lastName}` })
 * }
 * });
 * ```
 */
export function createGateway<TRegistry extends {delegate: any; types: any}>() {
  return {
    configure: <
      TPatch extends {
        [K in keyof TPatch]: K extends keyof TRegistry['types']
          ? (data: TRegistry['types'][K], api: GatewayContext<TRegistry>) => any
          : never
      }
    >(config: {
      url: string
      headers?: (ctx: Context) => Record<string, string>
      patches: TPatch
    }) => {
      return new PylonGateway<TRegistry, TPatch>(config)
    }
  }
}
