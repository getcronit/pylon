import type {DocInit} from './doc'
import {fieldStorageKey} from './hash'

/**
 * Maps `(ownerType, responseKey)` to a field's args-inclusive STORAGE KEY, or
 * `undefined` when the field takes no arguments on that type (so it keeps its bare
 * response key). Built from a document's compile-time `argSlots` plus the operation's
 * resolved variables — the SAME key the read path derives from a call's args, so the
 * write (normalize), the completeness gate (satisfied), and the read (wrap) all agree.
 */
export type SlotResolver = (
  ownerType: string | undefined,
  responseKey: string
) => string | undefined

export function buildSlotResolver(
  argSlots: DocInit['argSlots'],
  variables: Record<string, unknown> | undefined
): SlotResolver | undefined {
  if (!argSlots) return undefined
  return (ownerType, responseKey) => {
    if (ownerType === undefined) return undefined
    const slot = argSlots[`${ownerType}.${responseKey}`]
    if (!slot) return undefined
    const resolved: Record<string, unknown> = {}
    for (const [arg, varName] of Object.entries(slot.argVars)) {
      resolved[arg] = variables?.[varName]
    }
    return fieldStorageKey(slot.field, resolved)
  }
}
