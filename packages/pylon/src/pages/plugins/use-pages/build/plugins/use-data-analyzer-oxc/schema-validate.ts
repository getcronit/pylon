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

/** Resolve a field's candidate types across a set of base types — including, for
 *  interfaces/unions, the field as declared by every possible concrete member.
 *
 *  A field name can resolve to DIFFERENT types across the members of one abstract
 *  base (`rows: [AccountLedgerRow!]!` on AccountLedger vs `[TrialBalanceRow!]!` on
 *  TrialBalance). ALL of them are returned so the nested sub-selection is validated
 *  against their union — otherwise a sub-field that only one member's element type
 *  declares (e.g. `date` on AccountLedgerRow) is dropped just because another
 *  member was visited first. (The compiler re-partitions the union per member.) */
function fieldTypesOf(
  types: GraphQLNamedType[],
  key: string,
  schema: GraphQLSchema
): GraphQLOutputType[] {
  const out: GraphQLOutputType[] = []
  const seen = new Set<string>()
  const add = (t: GraphQLOutputType | undefined) => {
    if (!t) return
    const sig = String(t)
    if (seen.has(sig)) return
    seen.add(sig)
    out.push(t)
  }
  for (const type of types) {
    if (isObjectType(type) || isInterfaceType(type)) {
      add(type.getFields()[key]?.type as GraphQLOutputType | undefined)
    }
    if (isInterfaceType(type) || isUnionType(type)) {
      for (const member of schema.getPossibleTypes(type)) {
        add(member.getFields()[key]?.type as GraphQLOutputType | undefined)
      }
    }
  }
  return out // empty → scalar / enum / no member declares it
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
  typeOrTypes: GraphQLNamedType | GraphQLNamedType[],
  schema: GraphQLSchema
): void {
  // The current node may be validatable against SEVERAL candidate types at once —
  // the element types of a polymorphic abstract field (`rows` across members). Keep a
  // key if ANY candidate declares it; recurse into the union of the candidates.
  const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes]
  for (const key of Object.keys(tree)) {
    if (key === '__args' || key === '__isList' || key === '__typename') continue
    const fts = fieldTypesOf(types, key, schema)
    if (fts.length === 0) {
      delete tree[key] // not a schema field (on any candidate or its members) → drop
      continue
    }
    const named = fts.map(t => getNamedType(t))
    const list = fts.some(isListDeep)
    const leaf = named.every(isLeafType)
    // Candidate named types to recurse into (the object/interface/union ones).
    const childTypes = named.filter(n => !isLeafType(n))
    const child = tree[key]

    // Arg-branch array: same field, different args → one node per branch.
    if (Array.isArray(child)) {
      for (const b of child as SelectorNode[]) {
        if (!b || typeof b !== 'object') continue
        if (leaf) {
          for (const k of Object.keys(b)) if (k !== '__args' && k !== '__isList') delete b[k]
        } else {
          if (list) b.__isList = true
          else delete b.__isList
          validateSelection(b, childTypes, schema)
        }
      }
      continue
    }

    const childArgs =
      child && typeof child === 'object' && !Array.isArray(child)
        ? (child as SelectorNode).__args
        : undefined

    if (leaf) {
      if (childArgs !== undefined || list) {
        const l: SelectorNode = {}
        if (childArgs !== undefined) l.__args = childArgs
        if (list) l.__isList = true
        tree[key] = l
      } else {
        tree[key] = true
      }
      continue
    }

    // object / interface / union → recurse against the UNION of candidate types.
    const node: SelectorNode =
      child && typeof child === 'object' && !Array.isArray(child)
        ? (child as SelectorNode)
        : {}
    if (list) node.__isList = true
    else delete node.__isList
    validateSelection(node, childTypes, schema)
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
