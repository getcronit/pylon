import {
  FieldNode,
  getNamedType,
  GraphQLField,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLUnionType,
  isInterfaceType,
  isNonNullType,
  isObjectType,
  Kind,
  SelectionSetNode,
  valueFromASTUntyped
} from 'graphql'

// ---------------------------------------------------------------------------
// 1. Interfaces
// ---------------------------------------------------------------------------

export interface ExecutionArgument {
  name: string
  value: any
}

export interface ExecutionContext {
  name: string
  fields: ExecutionContext[]
  arguments: ExecutionArgument[]
}

// ---------------------------------------------------------------------------
// 2. TTL Cache Implementation
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60 * 1000 // 1 Minute TTL
const MAX_CACHE_SIZE = 1000

interface CacheEntry {
  data: ExecutionContext
  expiry: number
}

const planCache = new Map<string, CacheEntry>()

function getFromCache(key: string): ExecutionContext | undefined {
  const entry = planCache.get(key)
  if (!entry) return undefined

  if (Date.now() > entry.expiry) {
    planCache.delete(key)
    return undefined
  }

  return entry.data
}

function setToCache(key: string, data: ExecutionContext) {
  // Prevent memory leaks by clearing old cache if it gets too big
  if (planCache.size >= MAX_CACHE_SIZE) {
    const now = Date.now()
    for (const [k, v] of planCache.entries()) {
      if (v.expiry <= now) planCache.delete(k)
    }
    // If still full, clear arbitrary 20% to make space
    if (planCache.size >= MAX_CACHE_SIZE) {
      const keysToDelete = Array.from(planCache.keys()).slice(
        0,
        MAX_CACHE_SIZE / 5
      )
      keysToDelete.forEach(k => planCache.delete(k))
    }
  }

  planCache.set(key, {
    data,
    expiry: Date.now() + CACHE_TTL_MS
  })
}

// ---------------------------------------------------------------------------
// 3. Main Entry Point (Cached)
// ---------------------------------------------------------------------------

/**
 * Gets the ExecutionContext tree, checking the TTL cache first.
 */
export function getExecutionContext(
  info: GraphQLResolveInfo
): ExecutionContext {
  // Generate a cache key based on the Query body + Variables
  // Note: specific location in source + variables defines the unique execution path
  const key = `${info.operation.loc?.start}-${info.operation.loc?.end}:${JSON.stringify(info.variableValues)}`

  const cached = getFromCache(key)
  // if (cached) {
  //   return cached
  // }

  const rootNode = info.fieldNodes[0]
  const parentType = info.parentType

  // We skip the root check for introspection here assuming the root is valid,
  // but processField handles strict checking.
  const plan = processField(rootNode, parentType, info)

  if (!plan) {
    throw new Error(
      'Could not generate execution plan (Root field might be introspection)'
    )
  }

  setToCache(key, plan)
  return plan
}

// ---------------------------------------------------------------------------
// 4. AST Traversal Logic
// ---------------------------------------------------------------------------

/**
 * Processes a single field node. Returns null if field is introspection.
 */
function processField(
  fieldNode: FieldNode,
  parentType: GraphQLObjectType | GraphQLInterfaceType,
  info: GraphQLResolveInfo
): ExecutionContext | null {
  const fieldName = fieldNode.name.value

  // BLOCK INTROSPECTION: Strictly ignore __typename, __schema, etc.
  if (fieldName.startsWith('__')) {
    return null
  }

  // 1. Get the Field Definition
  const fieldDef = parentType.getFields()[fieldName]

  // Safety: If schema definition is missing (and it's not introspection), skip it.
  if (!fieldDef) return null

  // 2. Extract arguments in Schema Order
  const args = extractArgumentsInSchemaOrder(fieldNode, fieldDef, info)

  // 3. Determine return type
  const returnType = getNamedType(fieldDef.type)
  let fields: ExecutionContext[] = []

  if (
    (isObjectType(returnType) || isInterfaceType(returnType)) &&
    fieldNode.selectionSet
  ) {
    fields = extractFields(fieldNode.selectionSet, returnType, info)
  }

  // 4. Auto-inject Discriminator Fields for Abstract Types (Unions / Interfaces)
  // This ensures that when querying an interface like `uploadedBy { id }`,
  // we also fetch unique fields like `username` so `__resolveType` has enough
  // data to score and determine the concrete type.
  if (
    isInterfaceType(returnType) ||
    info.schema.getType(returnType.name) instanceof GraphQLUnionType
  ) {
    const abstractType = info.schema.getType(returnType.name) as
      | GraphQLInterfaceType
      | GraphQLUnionType
    const possibleTypes = info.schema.getPossibleTypes(abstractType)

    // For each possible type, find one unique field and inject it
    for (const possibleType of possibleTypes) {
      const typeFieldsMap = possibleType.getFields()
      const typeFields = Object.keys(typeFieldsMap).filter(f =>
        isNonNullType(typeFieldsMap[f].type)
      )
      const otherTypes = possibleTypes.filter(t => t.name !== possibleType.name)

      const otherTypesFields = new Set(
        otherTypes.flatMap(t => Object.keys(t.getFields()))
      )

      const uniqueField = typeFields.find(f => !otherTypesFields.has(f))

      if (uniqueField && !fields.some(f => f.name === uniqueField)) {
        fields.push({
          name: uniqueField,
          arguments: [],
          fields: [] // Discriminators are typically scalar leaves
        })
      }
    }
  }

  return {
    name: fieldName,
    arguments: args,
    fields: fields
  }
}

/**
 * Recursively extracts fields from a SelectionSet.
 */
function extractFields(
  selectionSet: SelectionSetNode,
  parentType: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType,
  info: GraphQLResolveInfo
): ExecutionContext[] {
  const fields: ExecutionContext[] = []

  for (const selection of selectionSet.selections) {
    // BLOCK INTROSPECTION:
    // We check the name early to avoid processing __typename in any context
    if ('name' in selection && selection.name.value.startsWith('__')) {
      continue
    }

    switch (selection.kind) {
      case Kind.FIELD:
        if (isObjectType(parentType) || isInterfaceType(parentType)) {
          const processed = processField(selection, parentType, info)
          if (processed) fields.push(processed)
        }
        break

      case Kind.INLINE_FRAGMENT:
        const inlineType = selection.typeCondition
          ? (info.schema.getType(
              selection.typeCondition.name.value
            ) as GraphQLObjectType)
          : parentType

        if (
          selection.selectionSet &&
          (isObjectType(inlineType) || isInterfaceType(inlineType))
        ) {
          fields.push(
            ...extractFields(selection.selectionSet, inlineType, info)
          )
        }
        break

      case Kind.FRAGMENT_SPREAD:
        const fragmentName = selection.name.value
        const fragment = info.fragments[fragmentName]
        if (fragment) {
          const fragmentType = info.schema.getType(
            fragment.typeCondition.name.value
          ) as GraphQLObjectType
          if (
            fragment.selectionSet &&
            (isObjectType(fragmentType) || isInterfaceType(fragmentType))
          ) {
            fields.push(
              ...extractFields(fragment.selectionSet, fragmentType, info)
            )
          }
        }
        break
    }
  }

  return fields
}

/**
 * Extracts arguments based on the Schema Definition order.
 */
function extractArgumentsInSchemaOrder(
  fieldNode: FieldNode,
  fieldDef: GraphQLField<any, any>,
  info: GraphQLResolveInfo
): ExecutionArgument[] {
  const args: ExecutionArgument[] = []
  const queryArgMap = new Map<string, any>()

  if (fieldNode.arguments) {
    for (const arg of fieldNode.arguments) {
      // valueFromASTUntyped can be expensive, but it's now cached via the TTL plan
      const resolvedValue = valueFromASTUntyped(arg.value, info.variableValues)
      queryArgMap.set(arg.name.value, resolvedValue)
    }
  }

  for (const schemaArg of fieldDef.args) {
    const name = schemaArg.name

    if (queryArgMap.has(name)) {
      args.push({
        name: name,
        value: queryArgMap.get(name)
      })
    } else if (schemaArg.defaultValue !== undefined) {
      args.push({
        name: name,
        value: schemaArg.defaultValue
      })
    } else {
      args.push({
        name: name,
        value: undefined
      })
    }
  }

  return args
}
