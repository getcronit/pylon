import * as Sentry from '@sentry/bun'
import consola from 'consola'
import {
  FieldNode,
  getNamedType,
  GraphQLError,
  GraphQLErrorExtensions,
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLResolveInfo,
  GraphQLUnionType,
  isInterfaceType,
  isNonNullType,
  isObjectType,
  Kind,
  SelectionNode
} from 'graphql'

import {asyncContext, Context} from './context'
import {executionAsyncContext, ExecutionContext} from './resolve-info'

// Global caches for performance
const uniqueFieldsCache = new WeakMap<GraphQLNamedType, string[]>()
const selectionSetCache = new WeakMap<
  readonly SelectionNode[],
  Map<any, any[]>
>()

export interface Resolvers {
  Query: Record<string, any>
  Mutation?: Record<string, any>
  Subscription?: Record<string, any>
}

type PrimitiveType = string | number | boolean | null | undefined

type ResolverType =
  | Function
  | object
  | Promise<Function>
  | Promise<object>
  | PrimitiveType

export const getSelectedFields = (
  info: GraphQLResolveInfo,
  fieldNodes: readonly FieldNode[] = info.fieldNodes,
  parentType?: any
) => {
  // 1. Check cache for this selection set and parent type
  let parentCache = selectionSetCache.get(fieldNodes)
  if (!parentCache) {
    parentCache = new Map()
    selectionSetCache.set(fieldNodes, parentCache)
  }

  if (parentCache.has(parentType)) {
    return parentCache.get(parentType)!
  }

  const fieldsMap = new Map<string, {nodes: FieldNode[]; returnType?: any}>()

  const extract = (selections: readonly SelectionNode[], currentType?: any) => {
    for (const selection of selections) {
      if (selection.kind === Kind.FIELD) {
        const name = selection.name.value
        let childReturnType: any = undefined

        if (
          currentType &&
          (isObjectType(currentType) || isInterfaceType(currentType))
        ) {
          const fieldDef = currentType.getFields()[name]
          if (fieldDef) {
            childReturnType = getNamedType(fieldDef.type)
          }
        }

        if (!fieldsMap.has(name)) {
          fieldsMap.set(name, {nodes: [], returnType: childReturnType})
        }
        fieldsMap.get(name)!.nodes.push(selection)
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        const inlineType = selection.typeCondition
          ? info.schema.getType(selection.typeCondition.name.value)
          : currentType

        if (selection.selectionSet) {
          extract(selection.selectionSet.selections, inlineType)
        }
      } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const fragment = info.fragments[selection.name.value]
        if (fragment && fragment.selectionSet) {
          const fragmentType = info.schema.getType(
            fragment.typeCondition.name.value
          )
          extract(fragment.selectionSet.selections, fragmentType)
        }
      }
    }
  }

  for (const fieldNode of fieldNodes) {
    if (fieldNode.selectionSet) {
      extract(fieldNode.selectionSet.selections, parentType)
    }
  }

  const result = Array.from(fieldsMap.entries()).map(([name, data]) => ({
    name,
    fieldNodes: data.nodes,
    returnType: data.returnType
  }))

  // Auto-inject Discriminator Fields for Abstract Types
  if (
    parentType &&
    (isInterfaceType(parentType) || parentType instanceof GraphQLUnionType)
  ) {
    // Always carry `__typename` through the field projection (below, the resolved value
    // is re-projected to only its selected fields, dropping everything else). A resolver
    // stamps the concrete type name on its rows, so `resolveType` reads it back here.
    // This is the ONLY discriminant for members that add no unique NON-NULL field of
    // their own — e.g. single-table-inheritance subclasses Person/Organization or
    // FileAsset/FolderAsset, which are structurally identical to each other.
    if (!result.some(f => f.name === '__typename')) {
      result.push({name: '__typename', fieldNodes: [], returnType: undefined})
    }
    const abstractType = info.schema.getType(parentType.name) as
      | GraphQLInterfaceType
      | GraphQLUnionType
    const possibleTypes = info.schema.getPossibleTypes(abstractType)

    for (const possibleType of possibleTypes) {
      let uniqueField = uniqueFieldsCache.get(possibleType)?.[0]

      const typeFieldsMap = possibleType.getFields()

      if (uniqueField === undefined) {
        const typeFields = Object.keys(typeFieldsMap).filter(f =>
          isNonNullType(typeFieldsMap[f].type)
        )
        const otherTypes = possibleTypes.filter(
          t => t.name !== possibleType.name
        )
        const otherTypesFields = new Set(
          otherTypes.flatMap(t => Object.keys(t.getFields()))
        )

        const foundUniqueField = typeFields.find(f => !otherTypesFields.has(f))

        if (foundUniqueField) {
          uniqueFieldsCache.set(possibleType, [foundUniqueField])
          uniqueField = foundUniqueField
        } else {
          uniqueFieldsCache.set(possibleType, [])
          uniqueField = undefined
        }
      }

      if (uniqueField && !result.some(f => f.name === uniqueField)) {
        result.push({
          name: uniqueField,
          fieldNodes: [],
          returnType: getNamedType(typeFieldsMap[uniqueField].type)
        })
      }
    }
  }

  // 2. Cache the result before returning
  parentCache.set(parentType, result)

  return result
}

/**
 * Bind a function-valued field to its parent object, so `this` inside the
 * function is the source (e.g. an ORM model's computed-field method). Arrow
 * functions and plain resolvers ignore the binding, so this is always safe.
 */
function bindIfMethod(value: ResolverType, parent: unknown): ResolverType {
  return typeof value === 'function' ? (value as (...a: any[]) => any).bind(parent) : value
}

const wrapResolver = (
  resolver: ResolverType,
  context: ExecutionContext,
  fieldNodes?: readonly FieldNode[],
  parentType?: any
): any => {
  // Changed return type to allow sync returns

  // 1. FAST PATH: Primitives & Nulls
  if (
    resolver === null ||
    (typeof resolver !== 'object' && typeof resolver !== 'function')
  ) {
    return resolver
  }

  // 2. LEAF OBJECTS: Dates
  if (resolver instanceof Date) {
    return resolver
  }

  // 3. ASYNC NODES: Promises
  if (typeof (resolver as any).then === 'function') {
    // We can't await here if we want to stay sync-first.
    // We chain the promise and recurse.
    return (resolver as any).then((resolved: any) =>
      wrapResolver(resolved, context, fieldNodes, parentType)
    )
  }

  // 4. COLLECTIONS: Arrays
  if (Array.isArray(resolver)) {
    // If we have fieldNodes and parentType, pre-calculate selectedFields once for the whole array
    // This avoids O(Array.length * getSelectedFields) complexity
    const results = resolver.map(item =>
      wrapResolver(item, context, fieldNodes, parentType)
    )

    // Performance: Check if any result is a Promise
    if (results.some(r => r && typeof r.then === 'function')) {
      return Promise.all(results)
    }
    return results
  }

  // 5. EXECUTABLES: Functions
  // >>> THIS IS THE OPTIMIZATION <<<
  // We only activate ALS here, right before calling the user's function.
  if (typeof resolver === 'function') {
    return (args: Record<string, any>, ctx: any, info: GraphQLResolveInfo) => {
      // Evaluate selected properties specifically at this function's scope
      const currentParentType = getNamedType(info.returnType)
      const selectedFields = getSelectedFields(
        info,
        fieldNodes || info.fieldNodes,
        currentParentType
      )
      const executionContext = {info, selectedFields}

      return executionAsyncContext.run(executionContext, () => {
        const fieldDef = info.parentType.getFields()[info.fieldName]

        const orderedArgs = fieldDef
          ? fieldDef.args.map(arg =>
              args[arg.name] !== undefined ? args[arg.name] : arg.defaultValue
            )
          : []

        // Recurse on the result
        return wrapResolver(
          (resolver as Function)(...orderedArgs),
          executionContext,
          fieldNodes || info.fieldNodes,
          currentParentType
        )
      })
    }
  }

  // 6. COMPLEX NODES: Objects
  const selectedFields = getSelectedFields(
    context.info,
    fieldNodes || context.info.fieldNodes,
    parentType
  )

  if (selectedFields.length === 0) {
    return resolver
  }

  const result: Record<string, any> = {}

  for (const {name, fieldNodes: childNodes, returnType} of selectedFields) {
    // Check if ANY of the requested nodes for this field use an alias
    const hasAliases = childNodes.some(node => node.alias !== undefined)
    // If the field is a pylon resolver, we just wrap it and return it
    // If the field is not a pylon resolver, its gateway data and we need to choose the right key to resolve
    const isPylonResolver =
      resolver[name] && typeof resolver[name] === 'function'

    if (hasAliases && !isPylonResolver) {
      // We have a mix of aliases/non-aliases, or purely aliases.
      // We MUST return a function so we can dynamically route the data per execution.
      result[name] = (
        args: Record<string, any>,
        ctx: any,
        info: GraphQLResolveInfo
      ) => {
        const aliasKey = info.fieldNodes[0].alias?.value
        const schemaKey = info.fieldName

        // Priority 1: Check if this specific alias exists on the resolved object (Gateway data)
        if (aliasKey && (resolver as any)[aliasKey] !== undefined) {
          return wrapResolver(
            bindIfMethod((resolver as any)[aliasKey], resolver),
            context,
            info.fieldNodes,
            returnType
          )
        }

        // Priority 2: Fall back to the schema key (Local execution or unaliased Gateway data)
        const schemaValue = (resolver as any)[schemaKey]
        if (schemaValue !== undefined) {
          return wrapResolver(bindIfMethod(schemaValue, resolver), context, info.fieldNodes, returnType)
        }

        return undefined
      }
    } else {
      // Fast path: No aliases involved. Safely resolve statically.
      const rawValue = (resolver as any)[name]
      if (rawValue !== undefined) {
        // A function field is a method (e.g. a model's computed field) — bind it
        // to its parent so `this` is the source object inside the method.
        result[name] = wrapResolver(bindIfMethod(rawValue, resolver), context, childNodes, returnType)
      }
    }
  }

  return result

  return result
}

/**
 * Converts a set of resolvers into a corresponding set of GraphQL resolvers.
 * @param resolvers The original resolvers.
 * @returns The converted GraphQL resolvers.
 */
export const resolversToGraphQLResolvers = (
  resolvers: Resolvers,
  configureContext?: (context: Context) => Context
): Resolvers => {
  // Define a root resolver function that maps a given resolver function or object to a GraphQL resolver.
  const rootGraphqlResolver =
    (resolver: ResolverType) =>
    async (
      _: object,
      args: Record<string, any>,
      ctx: Context,
      info: GraphQLResolveInfo
    ) => {
      return Sentry.withScope(async scope => {
        const ctx = asyncContext.getStore()

        if (!ctx) {
          consola.warn(
            'Context is not defined. Make sure AsyncLocalStorage is supported in your environment.'
          )
        }

        ctx?.set('graphqlResolveInfo', info)

        // Core is auth-free: it no longer reads `c.get('auth')` to attribute the
        // Sentry user. An auth/identity layer (e.g. pylon-auth's `useIdentity`)
        // owns that attribution from the Principal, decoupled from core.

        // get query or mutation field

        const rootParentType = getNamedType(info.returnType)
        const selectedFields = getSelectedFields(
          info,
          info.fieldNodes,
          rootParentType
        )
        const executionContext = {info, selectedFields}

        return executionAsyncContext.run(executionContext, async () => {
          const wrapped = wrapResolver(
            resolver,
            executionContext,
            info.fieldNodes,
            rootParentType
          )

          if (typeof wrapped === 'function') {
            return wrapped(args, ctx, info)
          }

          return wrapped
        })
      })
    }

  // Convert the Query and Mutation resolvers to GraphQL resolvers.
  const graphqlResolvers = {} as Resolvers

  if (resolvers.Query && Object.keys(resolvers.Query).length > 0) {
    for (const [key, value] of Object.entries(resolvers.Query)) {
      if (!graphqlResolvers.Query) {
        graphqlResolvers.Query = {}
      }

      graphqlResolvers.Query[key] = rootGraphqlResolver(value)
    }
  }

  if (resolvers.Mutation && Object.keys(resolvers.Mutation).length > 0) {
    if (!graphqlResolvers.Mutation) {
      graphqlResolvers.Mutation = {}
    }

    for (const [key, value] of Object.entries(resolvers.Mutation)) {
      graphqlResolvers.Mutation[key] = rootGraphqlResolver(value)
    }
  }

  if (
    resolvers.Subscription &&
    Object.keys(resolvers.Subscription).length > 0
  ) {
    if (!graphqlResolvers.Subscription) {
      graphqlResolvers.Subscription = {}
    }

    for (const [key, value] of Object.entries(resolvers.Subscription)) {
      graphqlResolvers.Subscription[key] = {
        subscribe: rootGraphqlResolver(value),
        resolve: (payload: any) => payload
      }
    }
  }

  // Query root type must be provided.
  if (!graphqlResolvers.Query) {
    // Custom Error for Query root type must be provided.

    throw new Error(`At least one 'Query' resolver must be provided.

Example:

export const graphql = {
  Query: {
    // Define at least one query resolver here
    hello: () => 'world'
  }
}
`)
  }

  // Add extra resolvers (e.g. custom scalars) to the GraphQL resolvers.
  for (const key of Object.keys(resolvers)) {
    if (key !== 'Query' && key !== 'Mutation' && key !== 'Subscription') {
      graphqlResolvers[key] = resolvers[key]
    }
  }

  return graphqlResolvers
}

export class ServiceError extends GraphQLError {
  extensions: GraphQLErrorExtensions

  constructor(
    message: string,
    extensions: {
      code: string
      statusCode: number
      details?: Record<string, any>
    },
    error?: Error
  ) {
    super(message, {
      originalError: error
    })
    this.extensions = extensions
    this.cause = error
  }
}
