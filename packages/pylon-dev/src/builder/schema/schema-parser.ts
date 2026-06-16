import consola from 'consola'
import ts from 'typescript'
import {emptyIR, toSDL} from '@getcronit/pylon-ir'
import type {Field as IRField, Operation, PylonIR, TypeRef} from '@getcronit/pylon-ir'
import {
  TypeDefinitionBuilder,
  Enum as _Enum,
  Union as _Union
} from './type-definition-builder.js'
import { SCALAR_NAMES } from './scalars.js'

import {
  getPromiseType,
  getPublicPropertiesOfType,
  isFunction,
  isList,
  isPrimitive,
  isPrimitiveUnion,
  isPromise,
  isSubscriptionRepeater,
  safeTypeName
} from './types-helper.js'

type Union = _Union & {
  description: string
  __resolveType?: (obj: any) => string
}

type Interface = {
  name: string
  description: string
  fields: Array<Field>
  implements?: Array<string>
  __resolveType?: (obj: any) => string
}

type Enum = _Enum & {
  description: string
}

interface TypeRefDef {
  name: string
  isList: boolean
  isRequired: boolean
  isListRequired?: boolean
  /** For a list, the (possibly nested) element definition. */
  element?: TypeRefDef
}

interface TypeDefinition extends TypeRefDef {
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

/**
 * The introspection WORKING representation — distinct from `@getcronit/pylon-ir`
 * on purpose, and NOT redundant with it:
 *
 *   TS types ─▶ Schema (this) ─▶ ts.Type-dependent transforms ─▶ toIR() ─▶ PylonIR
 *              └── carries `rawType: ts.Type` ──┘                └ serializable, no ts.Type ┘
 *
 * The transform passes (interface promotion, inheritance→interface, unions) must
 * compare TypeScript type identities (`rawType === x`, `getSymbol()`,
 * `checker.typeToString(...)`), so this representation carries `ts.Type` handles.
 * `PylonIR` deliberately does NOT (it's a snapshot/diff/contribution artifact),
 * which is why `toIR()` is the projection boundary rather than a redundant copy.
 * All OUTPUTS (SDL via toSDL, SQL, migrations, ORM merge) flow from the IR; this
 * `Schema` exists only to do the `ts.Type`-dependent work that precedes it.
 */
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
  symbol: ts.Symbol
  args: {
    // value needs to be inputs type
    [key: string]: {
      type: ts.Type
      isRequired?: boolean
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
  inheritanceMap: Map<ts.Type, ts.Type[]>
  inputs: ReferenceSchema['types']
}

interface Index {
  Query?: ts.Type
  Mutation?: ts.Type
  Subscription?: ts.Type
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
      scalars: SCALAR_NAMES
    }

    this.checker = checker
    this.sfiFile = sfiFile
    this.program = program

    this.typeDefinitionBuilder = new TypeDefinitionBuilder(
      checker,
      this.schema,
      program
    )
  }

  /** Root operation type names captured during `parse`, used by `toIR`. */
  private rootTypeNames = new Set<string>()

  public parse(index: Index) {
    if (index.Query) this.rootTypeNames.add('Query')
    if (index.Mutation) this.rootTypeNames.add('Mutation')
    if (index.Subscription) this.rootTypeNames.add('Subscription')

    const referenceSchema = this.makeReferenceSchema(index)

    for (const [type, properties] of referenceSchema.types) {
      let typeName: string | undefined = undefined

      if (index.Query === type) {
        typeName = 'Query'
      } else if (index.Mutation === type) {
        typeName = 'Mutation'
      } else if (index.Subscription === type) {
        typeName = 'Subscription'
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

    // Remove `types` and `inputs` that are represented as enums
    this.schema.types = this.schema.types.filter(type => {
      return !this.schema.enums.find(e => e.name === type.name)
    })

    this.schema.inputs = this.schema.inputs.filter(input => {
      return !this.schema.enums.find(e => e.name === input.name)
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

    // Go through all inheritance and create interfaces
    for (const [baseType, derivedTypes] of referenceSchema.inheritanceMap) {
      const baseTypeName = safeTypeName(this.checker.typeToString(baseType))

      const interfaceName = `I${baseTypeName}`

      const baseSchemaType = this.schema.types.find(
        t => t.name === baseTypeName
      )

      if (baseSchemaType) {
        // Check if interface already exists
        let targetInterface: Interface | undefined =
          this.schema.interfaces.find(i => i.name === interfaceName)
        if (!targetInterface) {
          targetInterface = {
            name: interfaceName,
            description: baseSchemaType.description,
            fields: [...baseSchemaType.fields],
            implements: [],
            __resolveType: undefined // Will be set later
          }

          // Check if the base type has a base type that is also in the inheritance map
          const baseTypes = baseType.getBaseTypes()

          if (baseTypes) {
            baseTypes.forEach(baseBaseType => {
              // baseBaseType is already a Type (from getBaseTypes return value)
              const baseBaseTypeName = safeTypeName(
                this.checker.typeToString(baseBaseType)
              )
              const baseInterfaceName = `I${baseBaseTypeName}`

              if (referenceSchema.inheritanceMap.has(baseBaseType)) {
                targetInterface!.implements!.push(baseInterfaceName)
              } else {
                // Check if the base class is in the inheritance map by checking the symbol
                const baseBaseTypeSymbol = baseBaseType.getSymbol()
                if (baseBaseTypeSymbol) {
                  for (const [key] of referenceSchema.inheritanceMap) {
                    if (key.getSymbol() === baseBaseTypeSymbol) {
                      targetInterface!.implements!.push(baseInterfaceName)
                      break
                    }
                  }
                }
              }
            })
          }

          this.schema.interfaces.push(targetInterface)
        }

        // Add the `implements` field to the base type
        if (!baseSchemaType.implements) {
          baseSchemaType.implements = []
        }

        if (!baseSchemaType.implements.includes(interfaceName)) {
          baseSchemaType.implements.push(interfaceName)
        }

        // Add the `implements` field to the derived types
        const addInterfaceToDerived = (types: ts.Type[]) => {
          for (const derivedType of types) {
            const derivedTypeName = safeTypeName(
              this.checker.typeToString(derivedType)
            )
            const derivedSchemaType = this.schema.types.find(
              t => t.name === derivedTypeName
            )

            if (derivedSchemaType) {
              if (!derivedSchemaType.implements) {
                derivedSchemaType.implements = []
              }

              if (!derivedSchemaType.implements.includes(interfaceName)) {
                derivedSchemaType.implements.push(interfaceName)
              }
            }

            // Check if this derived type is also a base type for other types
            // We need to find the key in the inheritanceMap that matches the derivedType
            // Since we established earlier that object identity might be an issue, let's try strict matching first, then symbol matching
            let subDerivedTypes =
              referenceSchema.inheritanceMap.get(derivedType)

            if (!subDerivedTypes) {
              const derivedTypeSymbol = derivedType.getSymbol()
              if (derivedTypeSymbol) {
                for (const [key, value] of referenceSchema.inheritanceMap) {
                  if (key.getSymbol() === derivedTypeSymbol) {
                    subDerivedTypes = value
                    break
                  }
                }
              }
            }

            if (subDerivedTypes) {
              addInterfaceToDerived(subDerivedTypes)
            }
          }
        }

        addInterfaceToDerived(derivedTypes)

        // Replace the base type with the interface type in the schema
        this.schema.types.forEach(type => {
          type.fields.forEach(field => {
            if (field.type.name === baseTypeName) {
              field.type.name = interfaceName
            }
          })
        })
      }
    }

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

    // Remove `Void` fields from types when they have a implementation or are part of a union
    this.schema.types = this.schema.types.map(type => {
      if (
        type.implements ||
        this.schema.unions.find(u => u.types.includes(type.name))
      ) {
        // Remove Void fields
        type.fields = type.fields.filter(field => {
          return field.type.name !== 'Void'
        })
      }

      return type
    })

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

    const checks = entityTypes
      .map(type => {
        const otherTypes = entityTypes.filter(t => t.name !== type.name)
        const otherFields = new Set(
          otherTypes.flatMap(t => t.fields.map(f => f.name))
        )

        const uniqueField = type.fields.find(
          f => f.type.isRequired && !otherFields.has(f.name)
        )

        if (uniqueField) {
          return `if ("${uniqueField.name}" in node && node["${uniqueField.name}"] !== undefined) { return '${type.name}'; }`
        } else {
          // Fallback to checking all fields if a discriminant isn't possible
          const fieldChecks = type.fields
            .map(
              field =>
                `"${field.name}" in node && node["${field.name}"] !== undefined`
            )
            .join(' && ')

          return fieldChecks.length > 0
            ? `if (${fieldChecks}) { return '${type.name}'; }`
            : ''
        }
      })
      .filter(c => c.length > 0)

    const str = `function resolveType(node) { if (!node || typeof node !== 'object') return null; ${checks.join(' ')} return null; }`

    return new Function('return ' + str)()
  }

  /**
   * Project the parsed schema into the Pylon IR — the normalized, ORM-agnostic
   * model that every downstream artifact reads. This translates Pylon's internal
   * `Schema` (its long-standing proto-IR) into the shared `PylonIR` shape; it
   * does NOT re-walk TypeScript types.
   *
   * Scope: object types, root operations (with args), interfaces, enums and
   * scalars. Unions and input objects are not modelled yet — callers needing
   * full parity must still use `toString()` for those. This method is additive
   * and does not affect `toString()`/`getSchema()`/`getResolvers()`.
   */
  public toIR(): PylonIR {
    const ir = emptyIR()
    ir.scalars = [...this.schema.scalars]
    const scalarSet = new Set(this.schema.scalars)

    interface TD {
      name: string
      isList: boolean
      isRequired: boolean
      isListRequired?: boolean
      element?: TD
    }
    const typeRefOf = (td: TD): TypeRef => {
      // Walk the element chain ONLY to learn the list nesting depth and each
      // level's required flag, so `number[][]` renders `[[Number!]!]!` instead
      // of collapsing. The leaf name/nullability come from the outer `td` — its
      // `name` carries any interface-promotion rewrite (e.g. User → IUser), and
      // `isRequired` propagates the leaf's nullability through every level.
      const listRequired: boolean[] = []
      let cur: TD = td
      while (cur.isList) {
        listRequired.push(!!cur.isListRequired)
        if (!cur.element) break
        cur = cur.element
      }
      let ref: TypeRef = {
        kind: scalarSet.has(td.name) ? 'scalar' : 'ref',
        name: td.name,
        nullable: !td.isRequired
      }
      for (let i = listRequired.length - 1; i >= 0; i--) {
        ref = {kind: 'list', of: ref, nullable: !listRequired[i]}
      }
      return ref
    }

    const fieldOf = (f: {name: string; type: any; args?: any[]}): IRField => ({
      name: f.name,
      type: typeRefOf(f.type),
      exposed: true,
      description: f.type.description || undefined,
      // Callable fields (methods / paginated relations) carry GraphQL args, same
      // shape as an operation's — projected so `field(first: Int, …): T` renders.
      ...(f.args && f.args.length
        ? {
            args: f.args.map(a => ({
              name: a.name,
              type: typeRefOf(a.type),
              exposed: true,
              description: a.type.description || undefined
            }))
          }
        : {})
    })

    for (const type of this.schema.types) {
      if (this.rootTypeNames.has(type.name)) {
        for (const f of type.fields) {
          ir.operations.push({
            root: type.name as Operation['root'],
            name: f.name,
            args: (f.args ?? []).map(a => ({
              name: a.name,
              type: typeRefOf(a.type),
              exposed: true,
              description: a.type.description || undefined
            })),
            returns: typeRefOf(f.type),
            description: f.type.description || undefined
          })
        }
      } else {
        ir.objects[type.name] = {
          name: type.name,
          description: type.description || undefined,
          implements: type.implements ? [...type.implements] : undefined,
          fields: type.fields.map(fieldOf)
        }
      }
    }

    for (const intf of this.schema.interfaces) {
      ir.interfaces[intf.name] = {
        name: intf.name,
        description: intf.description || undefined,
        implements: intf.implements ? [...intf.implements] : undefined,
        fields: intf.fields.map(fieldOf)
      }
    }

    for (const input of this.schema.inputs) {
      ir.inputs[input.name] = {
        name: input.name,
        description: input.description || undefined,
        fields: input.fields.map(fieldOf)
      }
    }

    for (const union of this.schema.unions) {
      ir.unions[union.name] = {
        name: union.name,
        description: union.description || undefined,
        members: [...union.types]
      }
    }

    for (const en of this.schema.enums) {
      ir.enums[en.name] = {
        name: en.name,
        values: [...en.values],
        description: en.description || undefined
      }
    }

    return ir
  }

  /**
   * Render the schema as SDL by projecting the IR. This is the single rendering
   * path: `toString` is `toSDL(toIR())`. Proven graphql-equivalent to the former
   * hand-rolled renderer across the entire test corpus (see buildTestSchema's
   * equivalence gate) before the duplicate rendering logic was removed.
   */
  public toString() {
    return toSDL(this.toIR())
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
      // Skip empty interfaces: toSDL drops them (an empty interface is invalid
      // GraphQL), so emitting a resolver would dangle — makeExecutableSchema
      // throws "<name> defined in resolvers, but not in schema". Keep this in
      // lockstep with toSDL's empty-interface drop.
      if (intf.fields.length === 0) continue
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
    } else {
      // If the type already exists and has fields, we don't need to process it again.
      // This happens when multiple structurally identical types are unified to the same name.
      if (root.fields.length > 0) {
        return
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
            description: this.getSymbolDocumentation(property.symbol)
          },
          args: []
        }

        if (property.args) {
          for (const [argName, arg] of Object.entries(property.args)) {
            const argType = arg

            const fieldDef = getTypeDefinition(argType.type, {
              isInputType: true,
              propertyName:
                propertyName +
                argName.charAt(0).toUpperCase() +
                argName.slice(1),
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
      classImplementsMap: new Map(),
      inheritanceMap: new Map()
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

      if (isSubscriptionRepeater(type)) {
        // type: Repeater<{ id: number; title: string; content: string; }, any, unknown>

        const repeaterItemType = this.checker.getTypeArguments(type as any)[0]

        recLoop(repeaterItemType, info, processing, [...path, 'REPEATER_ITEM'])

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

      if (!!(type.getSymbol()?.flags! & ts.SymbolFlags.Class)) {
        const baseTypes = type.getBaseTypes()
        if (baseTypes) {
          baseTypes.forEach(baseType => {
            if (!!(baseType.getSymbol()?.flags! & ts.SymbolFlags.Class)) {
              if (!referenceSchema.inheritanceMap.has(baseType)) {
                referenceSchema.inheritanceMap.set(baseType, [])
              }
              referenceSchema.inheritanceMap.get(baseType)!.push(type)

              recLoop(baseType)
            }
          })
        }
      }

      if (type.isUnion()) {
        if (isPrimitiveUnion(type)) {
          if (!referenceSchema[processing].has(type)) {
            referenceSchema[processing].set(type, {})
          }

          recLoop(type, info, processing, [...path, 'ENUM'])
        } else {
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
            let firstType = type.getNonNullableType()

            if (firstType.isUnion() && !isPrimitive(firstType)) {
              consola.warn(
                `Warning: Union types in input fields are not supported yet. Defaulting to the first type (${this.checker.typeToString(
                  firstType
                )}) at path: ${path.join(' > ')}`
              )

              firstType = firstType.types[0]
            }

            recLoop(firstType, info, processing, [...path, 'NON_NULLABLE'])
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
          const argType = this.checker.getTypeOfSymbolAtLocation(
            arg,
            this.sfiFile
          )

          if (this.checker.isTupleType(argType)) {
            // Iterate over the rest of the arguments
            const tupleType = argType as ts.TupleType

            const elements = (tupleType.target as any)
              .labeledElementDeclarations

            elements.forEach((element, idx: number) => {
              const elementType = this.checker.getTypeAtLocation(element)

              const elementName = element.name.text
              const elementSymbol = this.checker.getSymbolAtLocation(element)

              const elementDocumentation = this.getSymbolDocumentation(
                elementSymbol || arg
              )

              schemaType.args[elementName] = {
                type: elementType,
                isRequired:
                  element.initializer === undefined ? undefined : false,
                documentation: elementDocumentation
              }

              recLoop(
                elementType,
                {
                  parentType: type
                },
                'inputs',
                [...path, elementName]
              )
            })
          } else if (
            arg.valueDeclaration &&
            ts.isParameter(arg.valueDeclaration) &&
            arg.valueDeclaration.dotDotDotToken
          ) {
            consola.warn(
              `Warning: Rest parameters without explicit names are not supported. ` +
                `Skipping rest parameter at path: ${path.join(' > ')}.\n\n` +
                `Unsupported: \`function example(...args: any[]) { }\`.\n` +
                `Supported: \`function example(...namedArgs: [first: string, second: number]) { }\`.\n` +
                `Please provide named rest parameters to ensure proper type resolution.`
            )
          } else {
            const valueDeclaration =
              arg.valueDeclaration as ts.ParameterDeclaration

            // set args to empty object if not set
            if (schemaType.args) {
              // An optional param — `x?: T` OR `x = default` — is a NULLABLE arg.
              // The `?` token matters under non-strict TS (where `x?: T` widens to
              // `T`, not `T | undefined`, so type-based nullability is lost).
              const optional =
                valueDeclaration.initializer !== undefined ||
                valueDeclaration.questionToken !== undefined
              schemaType.args[arg.escapedName as string] = {
                type: argType,
                isRequired: optional ? false : undefined,
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
              symbol: property,
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

    if (index.Subscription) {
      recLoop(index.Subscription)
    }

    // Handle classes that implement interfaces or extend classes of the schema
    const sourceFiles = this.program.getSourceFiles()

    for (const sourceFile of sourceFiles) {
      if (sourceFile.isDeclarationFile) continue

      ts.forEachChild(sourceFile, node => {
        if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
          const derivedType = this.checker.getTypeAtLocation(node)

          const heritageClauses = node.heritageClauses

          if (heritageClauses) {
            heritageClauses.forEach(clause => {
              clause.types.forEach(typeRef => {
                const baseType = this.checker.getTypeAtLocation(typeRef)

                // Add to inheritance map
                let foundBaseType = baseType

                // Try to find if this baseType is already in the inheritance map using symbol
                const baseTypeSymbol = baseType.getSymbol()
                if (baseTypeSymbol) {
                  for (const key of referenceSchema.inheritanceMap.keys()) {
                    if (key.getSymbol() === baseTypeSymbol) {
                      foundBaseType = key
                      break
                    }
                  }
                }

                if (!referenceSchema.inheritanceMap.has(foundBaseType)) {
                  referenceSchema.inheritanceMap.set(foundBaseType, [])
                }

                const derivedTypes =
                  referenceSchema.inheritanceMap.get(foundBaseType)!
                const derivedTypeSymbol = derivedType.getSymbol()

                if (
                  derivedTypeSymbol &&
                  !derivedTypes.some(t => t.getSymbol() === derivedTypeSymbol)
                ) {
                  derivedTypes.push(derivedType)
                }
              })
            })
          }
        }
      })
    }

    // Go through all types in the schema and check if we have any derived types that are not in the schema
    let changed = true
    while (changed) {
      changed = false
      for (const [baseType, derivedTypes] of referenceSchema.inheritanceMap) {
        let isBaseTypeInSchema = referenceSchema.types.has(baseType)

        if (!isBaseTypeInSchema) {
          const baseTypeSymbol = baseType.getSymbol()
          if (baseTypeSymbol) {
            for (const type of referenceSchema.types.keys()) {
              if (type.getSymbol() === baseTypeSymbol) {
                isBaseTypeInSchema = true
                break
              }
            }
          }
        }

        // Check if any derived type is in the schema
        let isAnyDerivedTypeInSchema = false
        for (const derivedType of derivedTypes) {
          if (referenceSchema.types.has(derivedType)) {
            isAnyDerivedTypeInSchema = true
            break
          }
          const derivedTypeSymbol = derivedType.getSymbol()
          if (derivedTypeSymbol) {
            for (const type of referenceSchema.types.keys()) {
              if (type.getSymbol() === derivedTypeSymbol) {
                isAnyDerivedTypeInSchema = true
                break
              }
            }
          }
          if (isAnyDerivedTypeInSchema) break
        }

        if (isBaseTypeInSchema) {
          for (const derivedType of derivedTypes) {
            let isDerivedTypeInSchema = referenceSchema.types.has(derivedType)

            if (!isDerivedTypeInSchema) {
              const derivedTypeSymbol = derivedType.getSymbol()
              if (derivedTypeSymbol) {
                for (const type of referenceSchema.types.keys()) {
                  if (type.getSymbol() === derivedTypeSymbol) {
                    isDerivedTypeInSchema = true
                    break
                  }
                }
              }
            }

            if (!isDerivedTypeInSchema) {
              recLoop(derivedType)
              changed = true
            }
          }
        } else if (isAnyDerivedTypeInSchema) {
          // If a derived type is in the schema, we must also have the base type
          recLoop(baseType)
          changed = true
        }
      }
    }

    return referenceSchema
  }
}
