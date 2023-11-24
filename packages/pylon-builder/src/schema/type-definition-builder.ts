import ts from 'typescript'
import {
  excludeNullUndefinedFromType,
  getPromiseType,
  isEmptyObject,
  isEnum,
  isFunction,
  isList,
  isPrimitive,
  isPromise,
  safeTypeName
} from './types-helper.js'
import {Schema} from './schema-parser.js'

export interface Union {
  name: string
  rawType: ts.Type
  types: Array<string>
}

export interface Enum {
  name: string
  rawType: ts.Type
  values: Array<string>
}

interface FieldDefinition {
  name: string
  isList: boolean
  isRequired: boolean
  isListRequired?: boolean
}

export class TypeDefinitionBuilder {
  private checker: ts.TypeChecker
  private schema: Schema

  private typesNameMap: Map<ts.Type, string> = new Map()
  private inputsNameMap: Map<ts.Type, string> = new Map()

  private unions: Array<Union> = []
  private enums: Array<Enum> = []

  constructor(checker: ts.TypeChecker, schema: Schema) {
    this.checker = checker
    this.schema = schema
  }

  getTypeDefinition = (
    rawType: ts.Type,
    options: {
      isInputType?: boolean
      isRequired?: boolean
      propertyName?: string
    } = {
      isInputType: false
    }
  ): FieldDefinition => {
    const {type, wasOptional} = excludeNullUndefinedFromType(rawType)

    if (isPromise(type)) {
      const promiseType = getPromiseType(type)
      if (promiseType) {
        return this.getTypeDefinition(promiseType, options)
      }
    }

    const isRequired =
      options.isRequired !== undefined ? options.isRequired : !wasOptional

    if (isEmptyObject(type)) {
      return {
        name: 'Object',
        isList: false,
        isRequired
      }
    }

    let nameMap = options.isInputType ? this.inputsNameMap : this.typesNameMap

    if (nameMap.has(type)) {
      const typeName = nameMap.get(type) as string

      return {
        name: typeName,
        isList: false,
        isRequired
      }
    }

    let typeName: string | undefined =
      type.aliasSymbol?.escapedName?.toString() ||
      type.symbol?.escapedName.toString()

    if (typeName === '__type' || typeName === '__object') {
      if (!options.propertyName) {
        typeName = undefined
      } else {
        const capitalizedPropertyName =
          options.propertyName.charAt(0).toUpperCase() +
          options.propertyName.slice(1)

        typeName = capitalizedPropertyName
      }
    }

    if (typeName) {
      typeName = safeTypeName(typeName)
    }

    const duplicateName = (name: string) => {
      // find name in typeNameMap
      return Array.from(nameMap.values()).includes(name)
    }

    if (typeName) {
      if (options.isInputType) {
        typeName = `${typeName}Input`
      }

      let i = 1
      let originalTypeName = typeName
      while (duplicateName(typeName as string)) {
        typeName = `${originalTypeName}_${i}`

        i++
      }
    }

    if (typeName && this.schema.scalars.includes(typeName)) {
      return {
        name: typeName,
        isList: false,
        isRequired
      }
    }

    if (isList(this.checker, type)) {
      const listType = this.checker.getIndexTypeOfType(
        type,
        ts.IndexKind.Number
      )

      if (listType) {
        const def = this.getTypeDefinition(listType, options)

        return {
          name: def.name,
          isList: true,
          isRequired: def.isRequired,
          isListRequired: isRequired
        }
      }
    } else if (isEnum(type)) {
      const typeNode = this.checker.typeToTypeNode(
        type,
        undefined,
        undefined
      ) as any | undefined

      const types = (type as ts.UnionType).types.filter(
        t => t.flags & ts.TypeFlags.StringLiteral
      )

      // enumerate all members of the enum
      const members = types.map((t: ts.Type) => {
        if (t.isLiteral()) {
          const name = t.value?.toString()

          if (!name) {
            throw new Error('Enum member name is undefined')
          }

          return safeTypeName(name)
        }

        throw new Error('Invalid type for enum member')
      })

      if (members.length > 0) {
        typeName = typeName || typeNode.typeName?.symbol?.escapedName

        if (!typeName) {
          typeName = members.join('_').toUpperCase()
          typeName = options.isInputType ? `${typeName}Input` : typeName
        }

        this.enums.push({
          name: typeName,
          values: members,
          rawType: type
        })
      }
    }
    // handle primitives
    else if (isPrimitive(type)) {
      let typeName = this.checker.typeToString(type)

      if (type.flags & ts.TypeFlags.StringLiteral) {
        typeName = 'String'
      } else if (type.flags & ts.TypeFlags.NumberLiteral) {
        typeName = 'Number'
      } else if (type.flags & ts.TypeFlags.BooleanLiteral) {
        typeName = 'Boolean'
      } else if (type.flags & ts.TypeFlags.String) {
        typeName = 'String'
      } else if (type.flags & ts.TypeFlags.Number) {
        typeName = 'Number'
      } else if (type.flags & ts.TypeFlags.Boolean) {
        typeName = 'Boolean'
      }

      return {
        name: safeTypeName(typeName),
        isList: false,
        isRequired
      }
    } else if (type.isIntersection()) {
      const intersectionTypes = type.types

      const typeNames = intersectionTypes.map(t => {
        const typeDef = this.getTypeDefinition(t, options)

        return typeDef.name
      })

      typeName = safeTypeName(typeName || typeNames.join('And'))
    } else if (type.isUnion()) {
      const unionTypes = type.types
      const required = type.types.length === unionTypes.length

      const hasPrimitivesOrEnum = unionTypes.some(t => {
        // If t is a array take the element type
        const type = isList(this.checker, t)
          ? this.checker.getIndexTypeOfType(t, ts.IndexKind.Number)
          : t

        if (!type) {
          // Return true if the type is undefined because we don't know what it is
          // Marking it as a primitive or enum will make it more error prone
          return true
        }

        return isPrimitive(type) || isEnum(type)
      })

      const unionTypeDefs = [
        ...new Set(
          unionTypes.map(t =>
            this.getTypeDefinition(t, {...options, isRequired: required})
          )
        )
      ]

      // If the union contains a array of some type, remove the type from the union because
      // the array type will be handled by the list type

      const listTypes = unionTypeDefs.filter(t => t.isList)

      // Check if the union contains the same type as a list
      for (const listType of listTypes) {
        const index = unionTypeDefs.findIndex(
          t => t.name === listType.name && !t.isList
        )

        if (index > -1) {
          unionTypeDefs.splice(index, 1)
        }
      }

      const typeNames = unionTypeDefs.map(t => t.name)

      typeName = safeTypeName(typeName || typeNames.join('Or'))

      if (
        unionTypeDefs.length > 1 &&
        !options.isInputType &&
        !hasPrimitivesOrEnum
      ) {
        this.unions.push({
          name: typeName,
          types: typeNames,
          rawType: type
        })
      } else {
        // We only care about the first type in the union since GraphQL doesn't support unions of input types
        const typeDef = unionTypeDefs[0]

        if (!typeDef) {
          throw new Error('Cannot get type definition')
        }

        // If the types contain a list of the same type as the first type, then we can make the first type a list
        const isList = unionTypeDefs.some(t => {
          return t.isList && t.name === typeDef.name
        })

        return {
          name: typeDef.name,
          isList,
          isRequired
        }
      }
    }
    // handle functions
    else if (isFunction(type)) {
      const signature = type.getCallSignatures()[0]
      let returnType = signature?.getReturnType()

      if (returnType) {
        if (isPromise(returnType)) {
          const pt = getPromiseType(returnType)

          if (pt) {
            returnType = pt
          }
        }
      }

      if (returnType) {
        const def = this.getTypeDefinition(returnType, options)

        return def
      }
    }

    if (!typeName) {
      typeName = 'Any'
    }

    nameMap.set(type, typeName)

    return {
      name: typeName,
      isList: false,
      isRequired
    }
  }

  public getUnions(): Array<Union> {
    return this.unions
  }

  public getEnums(): Array<Enum> {
    return this.enums
  }

  public typeDefinitionToGraphQLType = (
    typeDefinition: FieldDefinition
  ): string => {
    let type = typeDefinition.name
    const {isList, isRequired, isListRequired} = typeDefinition

    if (isRequired) {
      type = `${type}!`
    }

    if (isList) {
      type = `[${type}]`

      if (isListRequired) {
        type = `${type}!`
      }
    }

    return type
  }
}
