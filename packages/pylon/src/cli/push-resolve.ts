/**
 * Turn detected destructive drift into a confirmed `syncSchema` plan — shared by `db push` and
 * `db migrate`. The detection (orphan columns + rename candidates) comes from `pushPlan`
 * (push) or the diff (migrate); THIS decides what to actually do, through one of three channels:
 *
 *   • `--force`            → drop every remaining orphan (minus confirmed renames). No prompt.
 *   • interactive (TTY)    → ask per orphan: rename / drop / keep (the `prompt` callback).
 *   • non-interactive / CI → never drop implicitly: keep everything + emit `--rename`/`--force`
 *                            hints (the same warn-then-re-run contract `migrate` already uses).
 *
 * Confirmed renames (from `--rename` flags and/or the prompt) are data-preserving; "keep" leaves a
 * column in place (the engine still relaxes a leftover NOT NULL so it can't block inserts).
 *
 * Pure except for the injected `prompt` — so the decision logic is unit-tested without a TTY.
 */
import type {Rename} from '../ir'

export interface OrphanColumn {
  table: string
  column: string
}

export type OrphanDecision = 'rename' | 'drop' | 'keep'

/** Ask the operator about ONE orphan column. `candidate` is the matching rename suggestion, if any. */
export type OrphanPrompt = (o: OrphanColumn, candidate: Rename | undefined) => Promise<OrphanDecision>

export interface ResolveInput {
  /** Likely renames among the orphans (same-type drop+add), from `pushPlan` / the diff. */
  candidates: Rename[]
  /** Every orphan column (DB has it, the model dropped it). */
  orphans: OrphanColumn[]
  /** Renames the operator already confirmed via `--rename table.old=table.new`. */
  flagRenames: Rename[]
  /** `--force`: drop every remaining orphan without prompting. */
  force: boolean
  /** Prompt the operator? True only on a TTY with neither `--non-interactive` nor `CI`. */
  interactive: boolean
}

export interface ResolvePlan {
  renames: Rename[]
  dropColumns: OrphanColumn[]
  /** Advisory lines for the non-interactive path (nothing destructive was done). */
  warnings: string[]
}

const key = (o: {table: string; column: string}) => `${o.table}.${o.column}`

export async function resolvePushPlan(input: ResolveInput, prompt?: OrphanPrompt): Promise<ResolvePlan> {
  const renames = [...input.flagRenames]
  const renamedFrom = new Set(renames.map(r => key({table: r.table, column: r.from})))
  const remaining = input.orphans.filter(o => !renamedFrom.has(key(o)))
  const candidateFor = (o: OrphanColumn): Rename | undefined =>
    input.candidates.find(
      c => c.table === o.table && c.from === o.column && !renamedFrom.has(key({table: c.table, column: c.from}))
    )

  // --force: drop every remaining orphan (confirmed renames already excluded). No prompt.
  if (input.force) return {renames, dropColumns: remaining, warnings: []}

  // Non-interactive / CI: never drop implicitly — keep everything, emit the re-run hints.
  if (!input.interactive || !prompt) {
    const warnings = remaining.map(o => {
      const c = candidateFor(o)
      return c
        ? `possible rename ${o.table}.${o.column} → ${c.to} (kept). If it's a rename, re-run with ` +
            `--rename ${o.table}.${o.column}=${o.table}.${c.to}; otherwise --force to drop it.`
        : `orphan column ${o.table}.${o.column} kept (relaxed). Drop it with --force or a migration.`
    })
    return {renames, dropColumns: [], warnings}
  }

  // Interactive: ask about each remaining orphan.
  const dropColumns: OrphanColumn[] = []
  for (const o of remaining) {
    const c = candidateFor(o)
    const decision = await prompt(o, c)
    if (decision === 'rename' && c) renames.push(c)
    else if (decision === 'drop') dropColumns.push(o)
    // 'keep' → leave it (the engine relaxes a leftover NOT NULL)
  }
  return {renames, dropColumns, warnings: []}
}
