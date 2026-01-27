import ts from 'typescript'
import {
  excludeNullUndefinedFromType,
  getPromiseType,
  isEmptyObject,
  isPrimitiveUnion,
  isFunction,
  isList,
  isPrimitive,
  isPromise,
  isSubscriptionRepeater,
  safeTypeName,
  isLiteralType
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
  private program: ts.Program

  private typesNameMap: Map<ts.Type, string> = new Map()
  private inputsNameMap: Map<ts.Type, string> = new Map()

  private unions: Array<Union> = []
  private enums: Array<Enum> = []

  constructor(checker: ts.TypeChecker, schema: Schema, program: ts.Program) {
    this.checker = checker
    this.schema = schema
    this.program = program
  }

  private getExistingTypeByName(
    name: string,
    nameMap: Map<ts.Type, string>
  ): ts.Type | undefined {
    for (const [t, n] of nameMap.entries()) {
      if (n === name) return t
    }
    return undefined
  }

  private getUniqueName(
    type: ts.Type,
    originalName: string,
    nameMap: Map<ts.Type, string>,
    suffixPattern?: (suffix: string) => string
  ): string {
    let name = originalName
    let i = 1
    while (true) {
      const existingType = this.getExistingTypeByName(name, nameMap)

      if (!existingType) break

      if (
        this.checker.isTypeAssignableTo(type, existingType) &&
        this.checker.isTypeAssignableTo(existingType, type)
      ) {
        return name
      }

      const suffix = `_${i}`
      name = suffixPattern ? suffixPattern(suffix) : `${originalName}${suffix}`
      i++
    }
    return name
  }

  private isTypeSymbol(symbol: ts.Symbol | undefined): boolean {
    if (!symbol) return false
    return !!(
      symbol.flags &
      (ts.SymbolFlags.TypeAlias |
        ts.SymbolFlags.Interface |
        ts.SymbolFlags.Class |
        ts.SymbolFlags.Enum |
        ts.SymbolFlags.Type)
    )
  }

  getTypeDefinition = (
    rawType: ts.Type,
    options: {
      isInputType?: boolean
      isRequired?: boolean
      propertyName?: string
      dryRun?: boolean
    } = {
      isInputType: false,
      dryRun: false
    }
  ): FieldDefinition => {
    const {type, wasOptional} = excludeNullUndefinedFromType(rawType)

    if (
      type.flags & ts.TypeFlags.Void ||
      type.flags & ts.TypeFlags.Undefined ||
      type.flags & ts.TypeFlags.Null
    ) {
      return {
        name: 'Void',
        isList: false,
        isRequired: false
      }
    }

    if (type.flags & ts.TypeFlags.Any) {
      return {
        name: 'Any',
        isList: false,
        isRequired:
          options.isRequired !== undefined ? options.isRequired : !wasOptional
      }
    }

    if (isSubscriptionRepeater(type)) {
      const repeaterItemType = this.checker.getTypeArguments(type as any)[0]

      if (repeaterItemType) {
        return this.getTypeDefinition(repeaterItemType, options)
      }
    }

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

    if (typeName === '__type' || typeName === '__object' || !typeName) {
      const symbol = type.aliasSymbol || type.symbol

      if (symbol) {
        // Try to find a declaration that has a name (like a variable or property)
        const declarations = symbol.getDeclarations()
        if (declarations) {
          for (const declaration of declarations) {
            if ((declaration as any).name) {
              typeName = (declaration as any).name.escapedText?.toString()
              break
            }

            // If it's an object literal, check its parent (e.g. variable declaration, parameter, property)
            let parent = declaration.parent
            while (parent) {
              if (
                ts.isVariableDeclaration(parent) ||
                ts.isPropertyDeclaration(parent) ||
                ts.isPropertySignature(parent) ||
                ts.isParameter(parent) ||
                ts.isPropertyAssignment(parent)
              ) {
                if (ts.isIdentifier(parent.name)) {
                  typeName = parent.name.escapedText.toString()
                  break
                }
              }
              parent = parent.parent
            }
            if (typeName) break
          }
        }
      }
    }

    const ignoredPropertyNames = [
      'edges',
      'node',
      'pageInfo',
      'totalCount',
      'items',
      'args'
    ]

    const effectivePropertyName =
      options.propertyName &&
      !ignoredPropertyNames.includes(options.propertyName)
        ? options.propertyName
        : undefined

    if (typeName === '__type' || typeName === '__object' || !typeName) {
      if (effectivePropertyName) {
        const capitalizedPropertyName =
          effectivePropertyName.charAt(0).toUpperCase() +
          effectivePropertyName.slice(1)

        typeName = capitalizedPropertyName
      }
    }

    const isLibraryType = (type: ts.Type): boolean => {
      const symbol = type.aliasSymbol || type.symbol
      if (!symbol) return false

      const declarations = symbol.getDeclarations()
      if (!declarations) return false

      return declarations.some(d => {
        const sourceFile = d.getSourceFile()
        return (
          this.program.isSourceFileDefaultLibrary(sourceFile) ||
          sourceFile.fileName.includes('node_modules/typescript/lib')
        )
      })
    }

    if (typeName) {
      // Check if it's a generic specialization
      const typeReference = type as ts.TypeReference
      let typeArguments = this.checker.getTypeArguments(typeReference)

      // Fallback to alias type arguments for type aliases
      if (typeArguments.length === 0 && (type as any).aliasTypeArguments) {
        typeArguments = (type as any).aliasTypeArguments
      }

      const libraryType = isLibraryType(type)
      const isTypeAlias = !!type.aliasSymbol

      // If it's a type alias and NOT a library utility, we should definitely prefer the alias name
      // and NOT prefix it with its own arguments (which would lead to things like UserUser)
      const isUserAlias = isTypeAlias && !libraryType

      if (
        typeArguments.length > 0 &&
        !isUserAlias &&
        (!type.aliasSymbol ||
          type.aliasSymbol.escapedName.toString() !== typeName ||
          (type as any).aliasTypeArguments)
      ) {
        // Heuristic for utility types:
        // If it's a type alias from the library, it's likely a utility type like Omit/Pick.
        // We favor the first argument and skip any subsequent literal types to keep names clean.
        let relevantArguments = typeArguments

        if (libraryType && isTypeAlias) {
          relevantArguments = typeArguments.filter((arg, index) => {
            if (index === 0) return true // Always keep the first arg (the base type)
            const literal = isLiteralType(arg) || isPrimitiveUnion(arg)
            return !literal
          })
        }

        const argNames = relevantArguments.map(arg => {
          // Use dryRun for prefixes to avoid claiming names prematurely
          const def = this.getTypeDefinition(arg!, {...options, dryRun: true})
          return def.name
        })

        // Prefix base name with concatenated argument names
        const prefix = argNames.join('')

        // For library utility types (like Omit, Pick), we should STOP appending the utility name
        // (like UserOmit) and instead just use the prefix (User).
        // This will lead to a collision with the base type, which our getUniqueName
        // will handle by either unifying (if shapes match) or suffixing (User_1).
        if (libraryType && isTypeAlias) {
          typeName = prefix
        } else {
          // Avoid doubling up if the alias already contains the prefix
          if (!typeName.startsWith(prefix)) {
            typeName = `${prefix}${typeName}`
          }
        }
      }

      typeName = safeTypeName(typeName)

      // GraphQL types should be capitalized
      typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1)
    }

    if (typeName === 'JsonValue' || typeName === 'JsonObject') {
      return {
        name: 'JSON',
        isList: false,
        isRequired
      }
    }

    if (typeName === 'JsonArray') {
      return {
        name: 'JSON',
        isList: true,
        isRequired: true,
        isListRequired: isRequired
      }
    }

    if (typeName && !this.schema.scalars.includes(typeName)) {
      if (options.isInputType) {
        typeName = `${typeName}Input`
      }

      // If we have a generic type, we want to apply the suffix to the subject (prefix)
      // e.g. User_1Connection instead of UserConnection_1
      let suffixPattern: ((s: string) => string) | undefined

      if ((type as any).aliasTypeArguments || (type as any).typeArguments) {
        const typeReference = type as ts.TypeReference
        let typeArguments = this.checker.getTypeArguments(typeReference)
        if (typeArguments.length === 0 && (type as any).aliasTypeArguments) {
          typeArguments = (type as any).aliasTypeArguments
        }

        if (typeArguments.length > 0) {
          const firstArg = typeArguments[0]!
          const firstArgDef = this.getTypeDefinition(firstArg, {
            ...options,
            dryRun: true
          })
          const prefix = firstArgDef.name

          if (typeName.startsWith(prefix)) {
            const rest = typeName.slice(prefix.length)
            suffixPattern = (s: string) => `${prefix}${s}${rest}`
          }
        }
      }

      typeName = this.getUniqueName(type, typeName, nameMap, suffixPattern)
    }

    if (typeName && this.schema.scalars.includes(typeName)) {
      return {
        name: typeName,
        isList: false,
        isRequired
      }
    }

    // Check if the getUniqueName returned an existing type based on structural equality
    if (nameMap.has(type)) {
      return {
        name: nameMap.get(type)!,
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
    } else if (isPrimitiveUnion(type)) {
      const typeNode = this.checker.typeToTypeNode(
        type,
        undefined,
        undefined
      ) as any | undefined

      const types = (type as ts.UnionType).types

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

        if (!options.dryRun) {
          this.enums.push({
            name: typeName,
            values: members,
            rawType: type
          })
        }
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

        return isPrimitive(type) || isPrimitiveUnion(type)
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

      // check if typeName is a duplicate
      if (typeName) {
        typeName = this.getUniqueName(type, typeName, nameMap)
      }

      if (
        unionTypeDefs.length > 1 &&
        !options.isInputType &&
        !hasPrimitivesOrEnum
      ) {
        if (!options.dryRun) {
          this.unions.push({
            name: typeName,
            types: typeNames,
            rawType: type
          })
        }
      } else {
        // If the union contains a JSON, Object or Any type, remove the types
        // that are already present in the JSON, Object or Any type
        if (
          unionTypeDefs.some(
            t => t.name === 'JSON' || t.name === 'Object' || t.name === 'Any'
          )
        ) {
          return {
            name: 'JSON',
            isList: false,
            isRequired
          }
        }

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

    if (!options.dryRun) {
      nameMap.set(type, typeName)
    }

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
