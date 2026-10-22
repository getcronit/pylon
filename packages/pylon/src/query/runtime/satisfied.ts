import type {ShapeField} from './doc'
import type {SlotResolver} from './storage-key'

/**
 * Completeness gate for the operation-keyed store.
 *
 * The partial-read bug in a normalized cache is structural: an entity is shared
 * across operations, so op A can read a `Ticket:1` that op B populated WITHOUT a
 * field A selected (a narrower op never *added* it — merges are non-destructive,
 * so it isn't a drop, it simply isn't there yet). If the reader renders anyway,
 * that field surfaces as `undefined` and crashes downstream (`x.totalCount`).
 *
 * The fix (Relay's rule): only ever render an operation whose ENTIRE selection is
 * present in the store. `isSatisfied` walks the compiled selection `shape` against
 * the operation's data — dereferencing `{__ref}` values into the live entity table
 * — and returns false the moment a selected field is absent. `client.ensure` then
 * suspends (refetches) instead of handing a hole to component code.
 *
 * The invariant matches `wrap`'s old `fieldName in owner` check exactly:
 *   - a PRESENT key is satisfied even if its value is `null` — a nullable field or
 *     a feature-gated field legitimately resolves to `null`; `null` is a real
 *     answer, not a hole.
 *   - a MISSING key is a hole → unsatisfied.
 *
 * `deref` resolves normalized refs (identity for the non-normalized case), so the
 * walk sees the same live entities a read would.
 */
export type Deref = (value: any) => any

export function isSatisfied(
  shape: ShapeField[] | undefined,
  root: unknown,
  deref: Deref,
  slotResolver?: SlotResolver
): boolean {
  // No shape (hand-authored escape-hatch or mutation doc) → never gate: those docs
  // never participated in the completeness model, so keep their prior behavior.
  if (!shape) return true
  return satisfies(shape, root, deref, slotResolver)
}

function satisfies(
  shape: ShapeField[],
  value: unknown,
  deref: Deref,
  slotResolver?: SlotResolver
): boolean {
  const obj = deref(value)
  // A present-but-null parent is a legal leaf (nullable / feature-gated) — the
  // caller already confirmed the KEY is present; we don't recurse into null.
  if (obj == null) return true
  if (Array.isArray(obj)) return obj.every(el => satisfies(shape, el, deref, slotResolver))
  // A scalar reached where an object was expected (shape/type drift) → tolerate;
  // the read wrapper returns the raw value and completeness can't judge it.
  if (typeof obj !== 'object') return true

  const tn = (obj as {__typename?: string}).__typename
  // An arg-bearing field on an ENTITY is stored under its args-inclusive key (see
  // normalize), so the completeness check must look for that same key — not the bare
  // response key, which won't be present.
  const isEntity =
    typeof tn === 'string' && (obj as {id?: unknown}).id != null
  for (const f of shape) {
    // Inline-fragment field: only required on its concrete type.
    if (f.t && f.t !== tn) continue
    const slotKey = (isEntity && slotResolver?.(tn, f.k)) || f.k
    if (!(slotKey in (obj as object))) return false // selected field absent → hole
    if (f.s) {
      const child = (obj as Record<string, unknown>)[slotKey]
      // Present but null → satisfied (don't recurse); present object/list → recurse.
      if (child != null && !satisfies(f.s, child, deref, slotResolver)) return false
    }
  }
  return true
}
