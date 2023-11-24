import ts from 'typescript'

export const isEmptyObject = (type: ts.Type) => {
  return (
    type.flags & ts.TypeFlags.Object &&
    type.getProperties().length === 0 &&
    type.getCallSignatures().length === 0
  )
}

export const isList = (checker: ts.TypeChecker, type: ts.Type) => {
  const typeNode = checker.typeToTypeNode(type, undefined, undefined)

  const is = !!(
    typeNode &&
    (typeNode.kind === ts.SyntaxKind.ArrayType ||
      typeNode.kind === ts.SyntaxKind.TupleType)
  )

  return is
}

export const isBoolean = (type: ts.Type) => {
  // check if is union and all types are boolean
  if (type.isUnion()) {
    const isAllBooleans = type.types.every(
      t => t.flags & ts.TypeFlags.BooleanLiteral
    )

    return isAllBooleans
  }

  return false
}

export const isPrimitive = (type: ts.Type) => {
  const primitive =
    type.flags & ts.TypeFlags.String ||
    type.flags & ts.TypeFlags.Number ||
    type.flags & ts.TypeFlags.Boolean ||
    type.flags & ts.TypeFlags.StringLiteral ||
    type.flags & ts.TypeFlags.NumberLiteral ||
    type.flags & ts.TypeFlags.BooleanLiteral

  return primitive
}

export const isFunction = (type: ts.Type) => {
  return type.getCallSignatures().length > 0
}

export const isEnum = (type: ts.Type) => {
  if (isPrimitive(type)) return false

  const isUnion = (type as ts.UnionType).types?.length > 1

  if (isUnion) {
    // check if all types are primitives
    const isAllPrimitives = (type as ts.UnionType).types.every(
      t =>
        t.flags & ts.TypeFlags.StringLiteral ||
        t.flags & ts.TypeFlags.NumberLiteral ||
        t.flags & ts.TypeFlags.BooleanLiteral
    )

    if (isAllPrimitives) {
      return true
    }
  }

  return false
}

export const isPromise = (type: ts.Type) => {
  // check if type is a promise
  return type.getSymbol()?.getName() === 'Promise'
}

export const getPromiseType = (type: ts.Type) => {
  let objectType = type as ts.ObjectType

  if (objectType.objectFlags & ts.ObjectFlags.Reference) {
    const reference = type as ts.TypeReference
    const typeArguments = reference.typeArguments
    if (typeArguments && typeArguments.length > 0) {
      return typeArguments[0]
    }
  }
}

export const excludeNullUndefinedFromType = (type: ts.Type) => {
  if (!type.isUnion())
    return {
      type,
      wasOptional: false
    }

  const types = type.types.filter(
    t => !(t.flags & ts.TypeFlags.Undefined || t.flags & ts.TypeFlags.Null)
  )

  const wasOptional = types.length !== type.types.length

  return {
    type: type.getNonNullableType(),
    wasOptional
  }
}

export function getPublicPropertiesOfType(
  checker: ts.TypeChecker,
  _type: ts.Type
): ts.Symbol[] {
  let type = _type

  if (type.isUnion()) {
    // Filter out array types from the union if their non-array counterparts are also present
    const nonArrayTypes = type.types.filter(
      t =>
        !(
          t.flags & ts.TypeFlags.Object &&
          (t as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference &&
          (t as ts.TypeReference).typeArguments?.length
        )
    )
    const arrayElementTypes = type.types
      .filter(
        t =>
          t.flags & ts.TypeFlags.Object &&
          (t as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference &&
          (t as ts.TypeReference).typeArguments?.length
      )
      .map(t => (t as ts.TypeReference).typeArguments![0])
    const filteredTypes = nonArrayTypes.filter(
      t => !arrayElementTypes.some(et => et === t)
    )
    // .filter(t => {
    //   // filter out primitive types
    //   return !isPrimitive(t)
    // })

    // Create a new type that is the union of all the types in the union
    // This is necessary because the type checker will not resolve properties
    // that are only present on some types in the union
    // getUnionType is not available in TS 3.7, so we have to use the private API
    type = (checker as any).getUnionType(filteredTypes) as ts.Type
  }

  const properties: ts.Symbol[] = []

  // if type is a primitive, return empty array
  if (isList(checker, type) || isPrimitive(type) || isEnum(type))
    return properties

  let typeProperties: ts.Symbol[] = []

  typeProperties =
    (type as any).resolvedProperties || type.getProperties() || []

  for (const prop of typeProperties) {
    const isPublic =
      prop.valueDeclaration &&
      !(
        ts.getCombinedModifierFlags(prop.valueDeclaration) &
        ts.ModifierFlags.Private
      ) &&
      !prop.getName().startsWith('#')

    if (isPublic === false) {
      continue
    }

    properties.push(prop)
  }

  return properties
}

export const safeTypeName = (name: string) => {
  return name.replace(/[^0-9a-zA-Z_]/g, '_')
}
