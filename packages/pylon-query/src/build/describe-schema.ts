import {
  getNamedType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema,
  isEnumType,
  isInterfaceType,
  isListType,
  isObjectType,
  isScalarType,
  type GraphQLType
} from 'graphql'
import type {FieldDesc, SchemaDescriptor} from '../runtime/descriptor'

/**
 * Build the compact runtime descriptor the result wrapper needs: for every
 * object type, each field's named return type, whether it's a list, whether
 * it's a leaf (scalar/enum), and whether it's callable (declares arguments).
 *
 * Introspection types (`__Schema`, etc.) are skipped.
 */
export function describeSchema(schema: GraphQLSchema): SchemaDescriptor {
  const types: Record<string, Record<string, FieldDesc>> = {}

  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith('__')) continue
    // Object types AND interface types (the latter so the wrapper knows their
    // shared fields; concrete fields resolve via the runtime __typename).
    if (isObjectType(type) || isInterfaceType(type)) {
      types[type.name] = describeObject(type)
    }
  }

  return {
    query: schema.getQueryType()?.name ?? 'Query',
    types
  }
}

function describeObject(
  type: GraphQLObjectType | GraphQLInterfaceType
): Record<string, FieldDesc> {
  const out: Record<string, FieldDesc> = {}
  for (const field of Object.values(type.getFields())) {
    const named = getNamedType(field.type)
    const desc: FieldDesc = {type: named.name}
    if (isListAnywhere(field.type)) desc.list = true
    if (isScalarType(named) || isEnumType(named)) desc.scalar = true
    if (field.args.length > 0) desc.callable = true
    out[field.name] = desc
  }
  return out
}

function isListAnywhere(type: GraphQLType): boolean {
  let t: GraphQLType | undefined = type
  while (t) {
    if (isListType(t)) return true
    // unwrap NonNull
    t = (t as any).ofType
  }
  return false
}
