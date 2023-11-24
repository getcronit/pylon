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
import {appendFileSync} from 'fs'

type Union = _Union & {
  description: string
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
}

export interface Schema {
  types: Array<Type>
  inputs: Array<Input>
  unions: Array<Union>
  enums: Array<Enum>
  scalars: Array<string>
}

type ReferenceSchemaType = {
  returnType: ts.Type
  args: {
    // value needs to be inputs type
    [key: string]: ts.Type
  }
}

interface ReferenceSchema {
  types: Map<
    ts.Type,
    {
      [key: string]: ReferenceSchemaType
    }
  >
  inputs: ReferenceSchema['types']
}

interface Index {
  Query?: ts.Type
  Mutation?: ts.Type
}

export class SchemaParser {
  private schema: Schema
  private checker: ts.TypeChecker
  private sfiFile: ts.SourceFile
  private typeDefinitionBuilder: TypeDefinitionBuilder

  constructor(checker: ts.TypeChecker, sfiFile: ts.SourceFile) {
    this.schema = {
      types: [],
      inputs: [],
      unions: [],
      enums: [],
      scalars: [
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
          description: this.getJsDocHeaderFromType(union.rawType)
        }
      })

    this.schema.enums = this.typeDefinitionBuilder
      .getEnums()
      .map((enumType): Enum => {
        return {
          ...enumType,
          description: this.getJsDocHeaderFromType(enumType.rawType)
        }
      })
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
      schemaString += `type ${type.name} {\n`

      // loop over the fields in the type object
      for (const field of type.fields) {
        // build the argument list for the field if there is at least one argument
        let args = ''

        if (field.args.length > 0) {
          args = `(${field.args
            .map(
              arg =>
                `${addDescription(type.description)}${
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
          description: this.getJsDocHeaderFromType(type),
          fields: []
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
            description: this.getJsDocHeaderFromType(fieldType)
          },
          args: []
        }

        if (property.args) {
          for (const [argName, arg] of Object.entries(property.args)) {
            const argType = arg

            const fieldDef = getTypeDefinition(argType, {
              isInputType: true,
              propertyName: argName
            })

            if (
              this.schema.scalars.includes(this.checker.typeToString(argType))
            ) {
              fieldDef.name = this.checker.typeToString(argType)
            }

            field.args.push({
              name: argName,
              type: {
                ...fieldDef,
                description: this.getJsDocHeaderFromType(argType)
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
            description: this.getJsDocHeaderFromType(fieldType)
          }
        }

        if (!root.fields.find(f => f.name === field.name)) {
          root.fields.push(field)
        }
      }
    }
  }

  private getJsDocHeaderFromType = (type: ts.Type) => {
    let header = ''

    if (type.symbol) {
      const typeDeclaration = type.symbol.declarations?.[0] as unknown as
        | {
            jsDoc: ts.JSDoc[]
          }
        | undefined

      const comments = typeDeclaration?.jsDoc?.map(doc => doc.comment).join(' ')

      if (comments) {
        header = comments
      }

      const tags = type.symbol.getJsDocTags()
      const tagComments = tags
        ?.map(tag => `@${tag.name} ${tag.text?.map(t => t.text).join(' ')}`)
        .join('\n')

      if (tagComments) {
        header = `${header} ${tagComments}`
      }
    }

    return header
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
      inputs: new Map()
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
      // Write path to file
      appendFileSync(
        'path.txt',
        `${JSON.stringify(path)} type: ${this.checker.typeToString(
          type
        )} parentType: ${this.checker.typeToString(info.parentType!)}\n`
      )

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

            schemaType.args[arg.escapedName as string] = argType

            recLoop(
              argType,
              {
                parentType: type
              },
              'inputs',
              [...path, arg.escapedName as string]
            )
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

    return referenceSchema
  }
}
