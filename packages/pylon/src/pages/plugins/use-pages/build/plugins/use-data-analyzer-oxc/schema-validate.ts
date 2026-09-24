/**
 * Schema-directed normalization of a candidate selection tree.
 *
 * The interpreter records reads structurally (it cannot know GraphQL types on its
 * own). This pass makes the SCHEMA the authority: starting from a seed's root type
 * it walks the tree and, for each selected key, keeps it only if it is a real field
 * on the current type — dropping JS intrinsics/operations (`length`, `map`,
 * `includes`, `toString`, …) that leaked in — and sets `__isList` from the field's
 * actual `[…]` wrapping (adding it for list fields, removing a wrong one for
 * singular fields). Scalar/enum fields collapse to leaves; object fields recurse.
 *
 * Interfaces and unions: a flat field read off an abstract value is kept if ANY
 * possible concrete type declares it (the lowering distributes it into the right
 * `... on Type { … }` fragment). So a field only on one member still survives.
 *
 * Result: the compiled document can only contain fields that exist, and list-ness
 * is exact — resolving the object-vs-list ambiguity that structure alone cannot.
 */
import {
  getNamedType,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  type GraphQLNamedType,
  type GraphQLOutputType,
  type GraphQLSchema
} from 'graphql'
import type {SelectorNode} from './types'

/** True if the type is (or is a NonNull wrapper around) a list. */
function isListDeep(t: GraphQLOutputType): boolean {
  let x: GraphQLOutputType = t
  if (isNonNullType(x)) x = x.ofType
  return isListType(x)
}

/** Resolve a field's type on a type — including, for interfaces/unions, fields
 *  declared by any possible concrete member (so member-only reads are kept). */
function fieldTypeOf(
  type: GraphQLNamedType,
  key: string,
  schema: GraphQLSchema
): GraphQLOutputType | undefined {
  if (isObjectType(type) || isInterfaceType(type)) {
    const f = type.getFields()[key]
    if (f) return f.type as GraphQLOutputType
  }
  if (isInterfaceType(type) || isUnionType(type)) {
    for (const member of schema.getPossibleTypes(type)) {
      const f = member.getFields()[key]
      if (f) return f.type as GraphQLOutputType
    }
  }
  return undefined // scalar / enum / no member declares it
}

function isLeafType(named: GraphQLNamedType): boolean {
  return isScalarType(named) || isEnumType(named)
}

/**
 * Normalize `tree` in place against `type`. Unknown keys are removed; `__isList` is
 * set from the schema; scalar fields collapse to leaves; object/interface/union
 * fields recurse (abstract fields kept flat for the lowering to fragment).
 */
export function validateSelection(
  tree: SelectorNode,
  type: GraphQLNamedType,
  schema: GraphQLSchema
): void {
  for (const key of Object.keys(tree)) {
    if (key === '__args' || key === '__isList' || key === '__typename') continue
    const ft = fieldTypeOf(type, key, schema)
    if (!ft) {
      delete tree[key] // not a schema field (on this type or any member) → drop
      continue
    }
    const named = getNamedType(ft)
    const list = isListDeep(ft)
    const child = tree[key]

    // Arg-branch array: same field, different args → one node per branch.
    if (Array.isArray(child)) {
      for (const b of child as SelectorNode[]) {
        if (!b || typeof b !== 'object') continue
        if (isLeafType(named)) {
          for (const k of Object.keys(b)) if (k !== '__args' && k !== '__isList') delete b[k]
        } else {
          if (list) b.__isList = true
          else delete b.__isList
          validateSelection(b, named, schema)
        }
      }
      continue
    }

    const childArgs =
      child && typeof child === 'object' && !Array.isArray(child)
        ? (child as SelectorNode).__args
        : undefined

    if (isLeafType(named)) {
      if (childArgs !== undefined || list) {
        const leaf: SelectorNode = {}
        if (childArgs !== undefined) leaf.__args = childArgs
        if (list) leaf.__isList = true
        tree[key] = leaf
      } else {
        tree[key] = true
      }
      continue
    }

    // object / interface / union → recurse (member-aware via fieldTypeOf).
    const node: SelectorNode =
      child && typeof child === 'object' && !Array.isArray(child)
        ? (child as SelectorNode)
        : {}
    if (list) node.__isList = true
    else delete node.__isList
    validateSelection(node, named, schema)
    tree[key] = node
  }
}

/** Validate a seed's traced selection against its root type.
 *  `paginated` is skipped here — its result reads are relative to the connection
 *  type, so emit validates the full path-wrapped tree instead. */
export function validateSeed(
  tree: SelectorNode,
  rec: {kind: 'query' | 'paginated' | 'mutation' | 'operation'; opType?: 'query' | 'mutation'},
  schema: GraphQLSchema
): void {
  if (rec.kind === 'paginated') return
  const useMutationRoot = rec.kind === 'mutation' || rec.opType === 'mutation'
  const root = useMutationRoot ? schema.getMutationType() : schema.getQueryType()
  if (root) validateSelection(tree, root, schema)
}
