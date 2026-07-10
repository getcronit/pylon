import {
  getNamedType,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLSchema,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  type GraphQLInputType,
  type GraphQLOutputType
} from 'graphql'

const DEFAULT_SCALARS: Record<string, string> = {
  String: 'string',
  ID: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean'
}

/**
 * Generate the authoring-time `Data` root type from the schema, in Pylon's
 * callable-field style:
 *
 *   data.me.name                    // field property → scalar
 *   data.posts({ first: 10 }).edges // arg field → callable
 *
 * This is the type that makes `useData()` autocomplete BEFORE the analyzer
 * runs. It is the only thing we can't borrow from graphql-codegen (its output
 * has plain properties, not callable fields), so we emit it ourselves.
 */
export function generateRootType(
  schema: GraphQLSchema,
  scalarTypes: Record<string, string> = {}
): string {
  const scalars = {...DEFAULT_SCALARS, ...scalarTypes}
  const out: string[] = []
  const neededInputs = new Set<string>()

  const queryType = schema.getQueryType()
  const objectTypes = Object.values(schema.getTypeMap()).filter(
    (t): t is GraphQLObjectType => isObjectType(t) && !t.name.startsWith('__')
  )

  for (const type of objectTypes) {
    out.push(renderObject(type, scalars, neededInputs))
  }

  // Enums.
  for (const type of Object.values(schema.getTypeMap())) {
    if (isEnumType(type) && !type.name.startsWith('__')) {
      out.push(renderEnum(type))
    }
  }

  // Abstract types → a TS union of their concrete members, so a field typed as an
  // interface/union (e.g. `entity: SearchEntity`) resolves and narrows by
  // `__typename`. An INTERFACE maps to the union of its implementers; a UNION to its
  // members. Without this the object-type references above dangle (undefined name).
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith('__')) continue
    if (isInterfaceType(type)) {
      const impls = schema.getPossibleTypes(type).map(t => t.name)
      out.push(`export type ${type.name} = ${impls.length ? impls.join(' | ') : 'never'}`)
    } else if (isUnionType(type)) {
      const members = type.getTypes().map(t => t.name)
      out.push(`export type ${type.name} = ${members.length ? members.join(' | ') : 'never'}`)
    }
  }

  // Input object types referenced by field args.
  const emittedInputs = new Set<string>()
  const queue = [...neededInputs]
  while (queue.length) {
    const name = queue.pop()!
    if (emittedInputs.has(name)) continue
    emittedInputs.add(name)
    const t = schema.getType(name)
    if (t && isInputObjectType(t)) {
      out.push(renderInput(t, scalars, queue))
    }
  }

  const rootName = queryType?.name ?? 'Query'
  out.push(`export type Data = ${rootName}`)

  // Mutation root (callable-field style), for `useMutation` keyof typing.
  // Always emitted (even when empty) so the augmentation import never breaks.
  const mutationType = schema.getMutationType()
  const hasMutations =
    mutationType && Object.keys(mutationType.getFields()).length > 0
  out.push(
    hasMutations
      ? `export type Mutations = ${mutationType!.name}`
      : `export type Mutations = {}`
  )

  return out.join('\n\n') + '\n'
}

function renderObject(
  type: GraphQLObjectType,
  scalars: Record<string, string>,
  neededInputs: Set<string>
): string {
  // A `__typename` literal so unions/interfaces of these objects (e.g.
  // `SearchEntity = Ticket | Contact | …`) form a DISCRIMINATED union — a consumer
  // narrows with `if (e.__typename === 'Ticket')`. Harmless on non-member types
  // (GraphQL always resolves `__typename`).
  const members: string[] = [`  __typename: ${JSON.stringify(type.name)}`]
  for (const field of Object.values(type.getFields())) {
    const ret = renderOutput(field.type, scalars)
    if (field.args.length > 0) {
      const argMembers = field.args
        .map(a => {
          const optional = isNonNullType(a.type) ? '' : '?'
          collectInputs(a.type, neededInputs)
          return `${a.name}${optional}: ${renderInputRef(a.type, scalars)}`
        })
        .join('; ')
      const argsObj = `{ ${argMembers} }`
      const allOptional = field.args.every(a => !isNonNullType(a.type))
      members.push(`  ${field.name}(args${allOptional ? '?' : ''}: ${argsObj}): ${ret}`)
    } else {
      members.push(`  ${field.name}: ${ret}`)
    }
  }
  return `export interface ${type.name} {\n${members.join('\n')}\n}`
}

/**
 * Emit a GraphQL enum as a real, importable value alongside its type — not just
 * a bare string-literal union. The `as const` object gives runtime members
 * (`Status.ACTIVE`), and the same-named type alias keeps the type a string
 * union, so raw literals still assign (`data.status === "ACTIVE"`) and it unifies
 * with the analyzer's inline result types. Value + type share the name via TS
 * declaration merging.
 */
function renderEnum(type: GraphQLEnumType): string {
  const values = type.getValues()
  const members = values
    .map(v => `  ${v.name}: ${JSON.stringify(v.value)}`)
    .join(',\n')
  const union = values.map(v => JSON.stringify(v.value)).join(' | ')
  return (
    `export const ${type.name} = {\n${members}\n} as const\n\n` +
    `export type ${type.name} = ${union}`
  )
}

function renderInput(
  type: GraphQLInputObjectType,
  scalars: Record<string, string>,
  queue: string[]
): string {
  const members: string[] = []
  for (const field of Object.values(type.getFields())) {
    const optional = isNonNullType(field.type) ? '' : '?'
    collectInputs(field.type, new Set(queue))
    const named = getNamedType(field.type)
    if (isInputObjectType(named)) queue.push(named.name)
    members.push(`  ${field.name}${optional}: ${renderInputRef(field.type, scalars)}`)
  }
  return `export interface ${type.name} {\n${members.join('\n')}\n}`
}

// ── output type rendering (callable-field result types) ──────────────────────

function renderOutput(
  type: GraphQLOutputType,
  scalars: Record<string, string>
): string {
  if (isNonNullType(type)) return renderOutputNonNull(type.ofType, scalars)
  if (isListType(type)) return `Array<${renderOutput(type.ofType, scalars)}> | null`
  return `${namedOutput(type, scalars)} | null`
}

function renderOutputNonNull(
  type: GraphQLOutputType,
  scalars: Record<string, string>
): string {
  if (isListType(type)) return `Array<${renderOutput(type.ofType, scalars)}>`
  return namedOutput(type, scalars)
}

function namedOutput(
  type: GraphQLOutputType,
  scalars: Record<string, string>
): string {
  const named = getNamedType(type)
  if (isScalarType(named)) return scalars[named.name] ?? 'any'
  return named.name
}

// ── input type rendering (field args) ────────────────────────────────────────

function renderInputRef(
  type: GraphQLInputType,
  scalars: Record<string, string>
): string {
  if (isNonNullType(type)) return renderInputRefNonNull(type.ofType, scalars)
  if (isListType(type)) return `Array<${renderInputRef(type.ofType, scalars)}> | null`
  return `${namedInput(type, scalars)} | null`
}

function renderInputRefNonNull(
  type: GraphQLInputType,
  scalars: Record<string, string>
): string {
  if (isListType(type)) return `Array<${renderInputRef(type.ofType, scalars)}>`
  return namedInput(type, scalars)
}

function namedInput(
  type: GraphQLInputType,
  scalars: Record<string, string>
): string {
  const named = getNamedType(type)
  if (isScalarType(named)) return scalars[named.name] ?? 'any'
  return named.name
}

function collectInputs(type: GraphQLInputType, into: Set<string>): void {
  const named = getNamedType(type)
  if (isInputObjectType(named)) into.add(named.name)
}
