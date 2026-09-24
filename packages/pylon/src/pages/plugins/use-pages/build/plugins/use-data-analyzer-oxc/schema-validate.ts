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

function fieldTypeOf(type: GraphQLNamedType, key: string): GraphQLOutputType | undefined {
  if (isObjectType(type) || isInterfaceType(type)) {
    const f = type.getFields()[key]
    return f ? (f.type as GraphQLOutputType) : undefined
  }
  return undefined // scalar / enum / union → no traversable named fields
}

function isLeafType(named: GraphQLNamedType): boolean {
  return isScalarType(named) || isEnumType(named)
}

/**
 * Normalize `tree` in place against `type`. Unknown keys are removed; `__isList`
 * is set from the schema; scalar fields become leaves. Returns the normalized node
 * (which may replace a scalar's object node with `true`).
 */
export function validateSelection(
  tree: SelectorNode,
  type: GraphQLNamedType
): void {
  for (const key of Object.keys(tree)) {
    if (key === '__args' || key === '__isList') continue
    if (key === '__typename') continue // always valid
    const ft = fieldTypeOf(type, key)
    if (!ft) {
      delete tree[key] // not a schema field → JS intrinsic / invalid
      continue
    }
    const named = getNamedType(ft)
    const list = isListDeep(ft)
    const child = tree[key]

    // Arg-branch array: the same field read with different args → one node per
    // branch. Validate each against the field type.
    if (Array.isArray(child)) {
      for (const b of child as SelectorNode[]) {
        if (!b || typeof b !== 'object') continue
        if (isLeafType(named)) {
          for (const k of Object.keys(b)) if (k !== '__args' && k !== '__isList') delete b[k]
        } else {
          if (list) b.__isList = true
          else delete b.__isList
          if (!isUnionType(named)) validateSelection(b, named)
        }
      }
      continue
    }

    const childArgs =
      child && typeof child === 'object' && !Array.isArray(child)
        ? (child as SelectorNode).__args
        : undefined

    if (isLeafType(named)) {
      // scalar/enum leaf: `true`, or `{__args}` / `{__isList}` when it carries args
      // or is a list (matches the structural shape the lowering expects).
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

    // object / interface / union → recurse
    let node: SelectorNode =
      child && typeof child === 'object' && !Array.isArray(child)
        ? (child as SelectorNode)
        : {}
    if (list) node.__isList = true
    else delete node.__isList
    if (isUnionType(named)) {
      // only __typename survives on a bare union selection here
      for (const k of Object.keys(node)) {
        if (k !== '__args' && k !== '__isList' && k !== '__typename') delete node[k]
      }
    } else {
      validateSelection(node, named)
    }
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
  if (root) validateSelection(tree, root)
}
