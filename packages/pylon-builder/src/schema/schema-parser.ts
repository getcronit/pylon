import ts from 'typescript'
import {
  getPromiseType,
  getPublicPropertiesOfType,
  isFunction,
  isList,
  isPrimitive,
  isPromise
} from './types-helper.js'
import {
  TypeDefinitionBuilder,
  Union as _Union,
  Enum as _Enum
} from './type-definition-builder.js'
import consola from 'consola'

type Union = _Union & {
  description: string
  __resolveType?: (obj: any) => string
}

type Interface = {
  name: string
  description: string
  fields: Array<Field>
  __resolveType?: (obj: any) => string
}

type Enum = _Enum & {
  description: string
}

interface TypeDefinition {
  name: string
  isList: boolean
  isRequired: boolean
  description: string
}

interface Field {
  name: string
  type: TypeDefinition
}

interface Input {
  name: string
  description: string
  fields: Array<{
    name: string
    type: TypeDefinition
  }>
}

interface Type {
  name: string
  description: string
  fields: Array<
    Field & {
      args: Array<{
        name: string
        type: TypeDefinition
      }>
    }
  >
  implements?: Array<string>
  rawType: ts.Type
}

export interface Schema {
  types: Array<Type>
  inputs: Array<Input>
  interfaces: Array<Interface>
  unions: Array<Union>
  enums: Array<Enum>
  scalars: Array<string>
}

type ReferenceSchemaType = {
  returnType: ts.Type
  args: {
    // value needs to be inputs type
    [key: string]: {
      type: ts.Type
      isRequired: boolean
      documentation: string
    }
  }
}

interface ReferenceSchema {
  types: Map<
    ts.Type,
    {
      [key: string]: ReferenceSchemaType
    }
  >
  classImplementsMap: Map<ts.Type, ts.Type[]>
  inputs: ReferenceSchema['types']
}

interface Index {
  Query?: ts.Type
  Mutation?: ts.Type
}

export class SchemaParser {
  private schema: Schema
  private checker: ts.TypeChecker
  private program: ts.Program
  private sfiFile: ts.SourceFile
  private typeDefinitionBuilder: TypeDefinitionBuilder

  constructor(
    checker: ts.TypeChecker,
    sfiFile: ts.SourceFile,
    program: ts.Program
  ) {
    this.schema = {
      types: [],
      inputs: [],
      interfaces: [],
      unions: [],
      enums: [],
      scalars: [
        'ID',
        'Int',
        'Float',
        'Number',
        'Any',
        'Object',
        'File',
        'Date',
        'JSON',
        'String',
        'Boolean'
      ]
    }

    this.checker = checker
    this.sfiFile = sfiFile
    this.program = program

    this.typeDefinitionBuilder = new TypeDefinitionBuilder(checker, this.schema)
  }

  public parse(index: Index) {
    const referenceSchema = this.makeReferenceSchema(index)

    for (const [type, properties] of referenceSchema.types) {
      let typeName: string | undefined = undefined

      if (index.Query === type) {
        typeName = 'Query'
      } else if (index.Mutation === type) {
        typeName = 'Mutation'
      }

      this.processSchemaReference(type, properties, typeName, 'types')
    }

    for (const [type, properties] of referenceSchema.inputs) {
      this.processSchemaReference(type, properties, undefined, 'inputs')
    }

    this.extractForbiddenFieldNamesFromSchema()

    this.schema.unions = this.typeDefinitionBuilder
      .getUnions()
      .map((union): Union => {
        return {
          ...union,
          description: this.getTypeDocumentation(union.rawType)
        }
      })

    this.schema.enums = this.typeDefinitionBuilder
      .getEnums()
      .map((enumType): Enum => {
        return {
          ...enumType,
          description: this.getTypeDocumentation(enumType.rawType)
        }
      })

    // Go through all unions and check if it could be an interface

    this.schema.unions.forEach(union => {
      const interfaceUnion = this.checkIfInterfaceIsPossibleForUnion(
        union,
        this.schema.types
      )

      if (interfaceUnion) {
        this.schema.interfaces.push(interfaceUnion)

        // Remove the union from the types
        this.schema.unions = this.schema.unions.filter(
          type => type.name !== union.name
        )

        // Add the `implements` field to the types that implement the interface
        this.schema.types.map(type => {
          if (union.types.includes(type.name)) {
            if (!type.implements) {
              type.implements = []
            }

            type.implements.push(interfaceUnion.name)

            return type
          }
        })
      }
    })

    // // Go through all types and check if a type is an interface

    for (const [
      classType,
      implementingTypes
    ] of referenceSchema.classImplementsMap) {
      this.schema.types.map(type => {
        const schemaType = this.schema.types.find(t => t.rawType === classType)

        if (schemaType) {
          schemaType.implements = Array.from(
            new Set([
              ...(schemaType.implements || []),
              ...implementingTypes.map(t => this.checker.typeToString(t))
            ])
          )
        }

        return type
      })

      // Add the implementing types to the interfaces
      for (const implementingType of implementingTypes) {
        const schemaType = this.schema.types.find(
          t => t.rawType === implementingType
        )

        // Remove the implementing type from the types and add it to the interfaces

        if (schemaType) {
          this.schema.interfaces.push({
            name: this.checker.typeToString(implementingType),
            description: this.getTypeDocumentation(implementingType),
            fields: schemaType.fields
          })

          this.schema.types = this.schema.types.filter(
            type => type.rawType !== implementingType
          )
        }
      }
    }

    // Generate the __resolveType function for the unions
    this.schema.unions = this.schema.unions.map(union => {
      return {
        ...union,
        __resolveType: this.getResolveTypeForUnionOrInterface(
          union,
          this.schema.types
        )
      }
    })

    // Generate the __resolveType function for the interfaces
    this.schema.interfaces = this.schema.interfaces.map(intf => {
      return {
        ...intf,
        __resolveType: this.getResolveTypeForUnionOrInterface(
          intf,
          this.schema.types
        )
      }
    })
  }

  private checkIfInterfaceIsPossibleForUnion(
    union: Union,
    types: Array<Type>
  ): Interface | null {
    const unionTypes = union.types.map(t => {
      const type = types.find(type => type.name === t)

      if (!type) {
        throw new Error(`Type ${t} not found`)
      }

      return type
    })

    const baseType = unionTypes[0]

    // Check which fields are common in all types

    const commonFields = baseType.fields.filter(field => {
      return unionTypes.every(type => {
        return type.fields.some(
          f => JSON.stringify(f) === JSON.stringify(field)
        )
      })
    })

    if (commonFields.length > 0) {
      return {
        name: union.name,
        description: union.description,
        fields: commonFields
      }
    }

    return null
  }

  private getResolveTypeForUnionOrInterface(
    entity: Union | Interface,
    types: Array<Type>
  ) {
    const entityTypes =
      'types' in entity
        ? types.filter(t => entity.types.includes(t.name))
        : types.filter(t => t.implements?.includes(entity.name))

    // Sort fieldTypes by the number of fields in descending order.
    // This prioritizes types with more properties, which are more likely
    // to match a given node, thus reducing ambiguity in type resolution.
    entityTypes.sort((a, b) => b.fields.length - a.fields.length)

    // Check for unions with the exact same fields
    const fieldSignatures = new Map<string, Type>()

    entityTypes.forEach(type => {
      // Create a signature based on sorted field names
      const fieldNames = type.fields
        .map(field => field.name)
        .sort()
        .join(', ')

      if (fieldSignatures.has(fieldNames)) {
        const existingType = fieldSignatures.get(fieldNames)
        consola.warn(
          `Warning: Union types "${type.name}" and "${existingType?.name}" have the same fields: [${fieldNames}]. ` +
            `\nConsider differentiating these types by adding unique fields or using different type names.` +
            `\nThis may cause ambiguity in type resolution.`
        )
      } else {
        fieldSignatures.set(fieldNames, type)
      }
    })

    const checks = entityTypes.map(type => {
      const fields = type.fields

      const fieldChecks = fields
        .map(field => `"${field.name}" in node`)
        .join(' && ')

      return `if (${fieldChecks}) {return '${type.name}'};`
    })

    const str = `function resolveType(node) { if (node && typeof node === 'object') { ${checks.join(
      ' '
    )} } }`

    return new Function('return ' + str)()
  }

  public toString() {
    const {typeDefinitionToGraphQLType} = this.typeDefinitionBuilder

    const addDescription = (description: string) => {
      if (!description) return ''

      return `"""\n${description}\n"""\n`
    }

    // build a valid GraphQL schema string from the schema object
    let schemaString = ''

    // loop over the input objects in the schema
    for (const input of this.schema.inputs) {
      // add the input object to the schema string

      schemaString += addDescription(input.description)
      schemaString += `input ${input.name} {\n`

      // add a nop field to the input object if it has no fields
      if (input.fields.length === 0) {
        schemaString += `\t_ : String\n`
      }

      // loop over the fields in the input object
      for (const field of input.fields) {
        // add the field to the input object in the schema string
        schemaString += `${addDescription(field.type.description)}`
        schemaString += `\t${field.name}: ${typeDefinitionToGraphQLType(
          field.type
        )}\n`
      }

      schemaString += `}\n`
    }

    // loop over the type objects in the schema
    for (const type of this.schema.types) {
      if (type.fields.length === 0) continue

      // add the type object to the schema string
      schemaString += addDescription(type.description)
      schemaString += `type ${type.name}`
      if (type.implements) {
        schemaString += ` implements ${type.implements.join(' & ')}`
      }
      schemaString += ` {\n`

      // loop over the fields in the type object
      for (const field of type.fields) {
        // build the argument list for the field if there is at least one argument
        let args = ''

        if (field.args.length > 0) {
          args = `(${field.args
            .map(
              arg =>
                `${addDescription(arg.type.description)}${
                  arg.name
                }: ${typeDefinitionToGraphQLType(arg.type)}`
            )
            .join(', ')})`
        }

        // add the field to the type object in the schema string
        schemaString += `${addDescription(field.type.description)}`
        schemaString += `${field.name}${args}: ${typeDefinitionToGraphQLType(
          field.type
        )}\n`
      }

      schemaString += `}\n`
    }

    // loop over the union objects in the schema
    for (const union of this.schema.unions) {
      // add the union object to the schema string
      schemaString += addDescription(union.description)
      schemaString += `union ${union.name} = ${union.types.join(' | ')}\n`
    }

    // loop over the interface objects in the schema
    for (const intf of this.schema.interfaces) {
      // add the interface object to the schema string
      schemaString += addDescription(intf.description)
      schemaString += `interface ${intf.name} {\n`

      // loop over the fields in the interface object
      for (const field of intf.fields) {
        // add the field to the interface object in the schema string
        schemaString += `${addDescription(field.type.description)}`
        schemaString += `${field.name}: ${typeDefinitionToGraphQLType(
          field.type
        )}\n`
      }

      schemaString += `}\n`
    }

    // loop over the scalar objects in the schema
    for (const scalar of this.schema.scalars) {
      // add the scalar object to the schema string
      schemaString += `scalar ${scalar}\n`
    }

    // loop over the enum objects in the schema
    for (const enumType of this.schema.enums) {
      // add the enum object to the schema string
      schemaString += addDescription(enumType.description)
      schemaString += `enum ${enumType.name} {\n`

      // loop over the values in the enum object
      for (const value of enumType.values) {
        // add the value to the enum object in the schema string
        schemaString += `\t${value}\n`
      }

      schemaString += `}\n`
    }

    // return the schema string
    return schemaString
  }

  public getSchema() {
    return this.schema
  }

  public getResolvers() {
    // Get union and interface resolvers

    const resolvers: Record<
      string,
      {
        __resolveType?: (obj: any) => string
      }
    > = {}

    // loop over the union objects in the schema
    for (const union of this.schema.unions) {
      resolvers[union.name] = {
        __resolveType: union.__resolveType
      }
    }

    // loop over the interface objects in the schema
    for (const intf of this.schema.interfaces) {
      resolvers[intf.name] = {
        __resolveType: intf.__resolveType
      }
    }

    return resolvers
  }

  private processSchemaReference(
    type: ts.Type,
    properties: {[key: string]: ReferenceSchemaType},
    typeName?: string,
    processing: 'inputs' | 'types' = 'types'
  ) {
    const {getTypeDefinition} = this.typeDefinitionBuilder

    const isInputType = processing === 'inputs'

    const def = getTypeDefinition(type, {isInputType})

    const name = typeName || def.name

    let root = this.schema[processing].find(t => t.name === name)

    if (!root) {
      if (this.schema.scalars.includes(name)) {
        return
      } else {
        this.schema[processing].push({
          name,
          description: this.getTypeDocumentation(type),
          fields: [],
          rawType: isList(this.checker, type)
            ? type.getNumberIndexType() || type.getStringIndexType() || type
            : type
        })

        root = this.schema[processing][this.schema[processing].length - 1]!
      }
    }

    for (const [propertyName, property] of Object.entries(properties)) {
      const fieldType = property.returnType

      const fieldDef = getTypeDefinition(fieldType, {
        isInputType,
        propertyName
      })

      if (processing === 'types') {
        const field: Type['fields'][number] = {
          name: propertyName,
          type: {
            ...fieldDef,
            description: this.getTypeDocumentation(fieldType)
          },
          args: []
        }

        if (property.args) {
          for (const [argName, arg] of Object.entries(property.args)) {
            const argType = arg

            const fieldDef = getTypeDefinition(argType.type, {
              isInputType: true,
              propertyName: argName,
              isRequired: arg.isRequired
            })

            if (
              this.schema.scalars.includes(
                this.checker.typeToString(argType.type)
              )
            ) {
              fieldDef.name = this.checker.typeToString(argType.type)
            }

            field.args.push({
              name: argName,
              type: {
                ...fieldDef,
                description: argType.documentation
              }
            })
          }
        }

        root.fields.push(field)
      } else if (processing === 'inputs') {
        const field: Input['fields'][number] = {
          name: propertyName,
          type: {
            ...fieldDef,
            description: this.getTypeDocumentation(fieldType)
          }
        }

        if (!root.fields.find(f => f.name === field.name)) {
          root.fields.push(field)
        }
      }
    }
  }

  private getSymbolDocumentation(symbol: ts.Symbol) {
    let header = ''

    header += ts.displayPartsToString(
      symbol.getDocumentationComment(this.checker)
    )

    const tags = symbol
      .getJsDocTags(this.checker)
      .map(t => `@${t.name} ${ts.displayPartsToString(t.text)}`)
      .join('\n')

    if (tags) {
      header += '\n' + tags
    }

    return header
  }

  private getTypeDocumentation = (type: ts.Type) => {
    const symbol = type.getSymbol()

    if (symbol) {
      return this.getSymbolDocumentation(symbol)
    }

    return ''
  }

  /**
   * Extracts reserved field names from the schema by removing them from their respective types and inputs.
   */
  private extractForbiddenFieldNamesFromSchema(): void {
    // Define a regular expression to check if a field name is a valid GraphQL field name.
    const validFieldNameRegExp = /^[_A-Za-z][_0-9A-Za-z]*$/

    // Define a helper function to check if a field name is reserved.
    const isReserved = (name: string): boolean => {
      if (!validFieldNameRegExp.test(name)) {
        // console.warn(
        //   `\x1b[33mWarning: forbidden field name "${name}" detected\x1b[0m`
        // )
        return true
      }
      // Fields starting with "__" are considered reserved.
      return name.startsWith('__')
    }

    // Loop over each type in the schema and remove any reserved fields.
    for (const type of this.schema.types) {
      type.fields = type.fields.filter(field => {
        if (isReserved(field.name)) {
          // console.warn(
          //   `\x1b[33mWarning: forbidden field "${field.name}" detected in type "${type.name}". This field will be excluded from the schema.\x1b[0m`
          // )
          return false
        }
        return true
      })
    }

    // Loop over each input in the schema and remove any reserved fields.
    for (const input of this.schema.inputs) {
      input.fields = input.fields.filter(field => {
        if (isReserved(field.name)) {
          // console.warn(
          //   `\x1b[33mWarning: reserved field "${field.name}" detected in input "${input.name}". This field will be excluded from the schema.\x1b[0m`
          // )
          return false
        }
        return true
      })
    }
  }

  private makeReferenceSchema(index: Index): ReferenceSchema {
    const referenceSchema: ReferenceSchema = {
      types: new Map(),
      inputs: new Map(),
      classImplementsMap: new Map()
    }

    const recLoop = (
      type: ts.Type,
      info: {
        propetyName?: string
        parentType?: ts.Type
      } = {},
      processing: 'inputs' | 'types' = 'types',
      path: Array<string> = []
    ) => {
      if (referenceSchema[processing].has(type)) {
        return
      }

      // check if argType is a real type to ignore '[]'
      const wrongType = this.checker.typeToString(type) === '[]'

      if (wrongType) {
        return
      }

      // skip if scalar
      if (this.schema.scalars.includes(this.checker.typeToString(type))) {
        return
      }

      if (isPrimitive(type)) {
        return
      }

      if (isPromise(type)) {
        // skip if input
        if (processing === 'inputs') {
          return
        }

        const promiseType = getPromiseType(type)

        if (promiseType) {
          recLoop(promiseType, info, processing, [...path, 'PROMISE'])
        }

        return
      }

      if (type.isClass()) {
        const baseTypes = type.getBaseTypes()
        if (baseTypes) {
          baseTypes.forEach(baseType => {
            if (!referenceSchema.classImplementsMap.has(baseType)) {
              referenceSchema.classImplementsMap.set(baseType, [])
            }
            referenceSchema.classImplementsMap.get(baseType)!.push(type)
          })
        }
      }

      if (type.isUnion()) {
        if (processing === 'types') {
          type.types.forEach(t => {
            // if null or undefined, skip
            if (
              t.flags & ts.TypeFlags.Null ||
              t.flags & ts.TypeFlags.Undefined ||
              isPrimitive(t)
            ) {
              return
            }

            recLoop(t, info, processing, [
              ...path,
              t.symbol?.getName() || `N/A ${this.checker.typeToString(t)}`
            ])
          })
        } else {
          let properties = getPublicPropertiesOfType(
            this.checker,
            type.getNonNullableType()
          )

          if (properties.length === 0) {
            //get first union type of non nullable type
            const nt = type.getNonNullableType()
            if (nt.isUnion()) {
              properties = getPublicPropertiesOfType(this.checker, nt.types[0]!)
            }
          }

          if (properties.length > 0) {
            if (!referenceSchema[processing].has(type)) {
              referenceSchema[processing].set(type, {})
            }

            // Go through all properties of the union type and add them to the reference schema
            properties.forEach(property => {
              const propertyType = this.checker.getTypeOfSymbolAtLocation(
                property,
                this.sfiFile
              )

              if (!isFunction(propertyType)) {
                referenceSchema[processing].get(type)![
                  property.escapedName as string
                ] = {
                  returnType: propertyType,
                  args: {}
                }

                recLoop(
                  propertyType,
                  {
                    propetyName: property.escapedName as string,
                    parentType: type
                  },
                  processing,
                  [...path, property.escapedName as string]
                )
              }
            })
          }
        }
      } else if (isFunction(type)) {
        // skip fn for inputs
        if (processing === 'inputs') {
          return
        }

        if (!info.parentType) {
          throw new Error('Cannot have a function without a parent type')
        }

        const signature = type.getCallSignatures()[0]
        const args = signature?.getParameters() || []
        const returnType = signature?.getReturnType()

        const schemaType = referenceSchema[processing].get(info.parentType)![
          info.propetyName!
        ]!

        args.forEach(arg => {
          if (
            arg.valueDeclaration &&
            ts.isParameter(arg.valueDeclaration) &&
            arg.valueDeclaration.dotDotDotToken
          ) {
            console.warn(
              'Cannot handle rest parameters yet, skipping',
              arg.escapedName
            )
          } else {
            const argType = this.checker.getTypeOfSymbolAtLocation(
              arg,
              this.sfiFile
            )

            const valueDeclaration =
              arg.valueDeclaration as ts.ParameterDeclaration

            // set args to empty object if not set
            if (schemaType.args) {
              schemaType.args[arg.escapedName as string] = {
                type: argType,
                isRequired: valueDeclaration.initializer === undefined,
                documentation: this.getSymbolDocumentation(arg)
              }

              recLoop(
                argType,
                {
                  parentType: type
                },
                'inputs',
                [...path, arg.escapedName as string]
              )
            }
          }
        })

        if (returnType) {
          recLoop(returnType, info, processing, [...path, 'RETURN_TYPE'])
        }
      } else if (isList(this.checker, type)) {
        const itemType = this.checker.getIndexTypeOfType(
          type,
          ts.IndexKind.Number
        )

        if (itemType && !isPrimitive(itemType)) {
          if (!referenceSchema[processing].has(type)) {
            referenceSchema[processing].set(type, {})
          }

          recLoop(itemType, info, processing, [...path, 'ITEM_TYPE'])
        }
      } else if (!isPrimitive(type)) {
        const properties = getPublicPropertiesOfType(this.checker, type)

        if (!referenceSchema[processing].has(type)) {
          referenceSchema[processing].set(type, {})
        }

        properties.forEach(property => {
          const propertyType = this.checker.getTypeOfSymbolAtLocation(
            property,
            this.sfiFile
          )

          if (
            !referenceSchema[processing].get(type)![
              property.escapedName as string
            ]
          ) {
            referenceSchema[processing].get(type)![
              property.escapedName as string
            ] = {
              returnType: propertyType,
              args: {}
            }
          }

          recLoop(
            propertyType,
            {
              propetyName: property.escapedName as string,
              parentType: type
            },
            processing,
            [...path, property.escapedName as string]
          )
        })
      }
    }

    if (index.Query) {
      recLoop(index.Query)
    }

    if (index.Mutation) {
      recLoop(index.Mutation)
    }

    // Handle classes that implement interfaces of the schema
    const sourceFiles = this.program.getSourceFiles()

    for (const sourceFile of sourceFiles) {
      ts.forEachChild(sourceFile, node => {
        if (ts.isClassDeclaration(node)) {
          const baseTypes =
            node.heritageClauses?.flatMap(heritage =>
              heritage.types.map(type => {
                return type
              })
            ) || []

          // Check if the class implements an interface
          if (baseTypes.length > 0) {
            for (const baseType of baseTypes) {
              if (
                referenceSchema.types.has(
                  this.checker.getTypeAtLocation(baseType)
                )
              ) {
                referenceSchema.classImplementsMap.set(
                  this.checker.getTypeAtLocation(node),
                  [this.checker.getTypeAtLocation(baseType)]
                )

                recLoop(this.checker.getTypeAtLocation(node))
              }
            }
          }
        }
      })
    }

    return referenceSchema
  }
}
