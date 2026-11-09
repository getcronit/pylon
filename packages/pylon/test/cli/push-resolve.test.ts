import {describe, expect, it} from 'vitest'
import {resolvePushPlan, type OrphanColumn, type OrphanDecision} from '@/cli/push-resolve'
import type {Rename} from '@/ir'

const cand: Rename = {table: 'u', from: 'name', to: 'full_name'}
const orphans: OrphanColumn[] = [
  {table: 'u', column: 'name'}, // has a rename candidate (→ full_name)
  {table: 'u', column: 'junk'} // pure orphan
]

describe('resolvePushPlan', () => {
  it('--force drops every remaining orphan (no prompt)', async () => {
    const plan = await resolvePushPlan({
      candidates: [cand],
      orphans,
      flagRenames: [],
      force: true,
      interactive: true // ignored under --force
    })
    expect(plan.dropColumns).toEqual(orphans)
    expect(plan.renames).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  it('a flag rename is applied and excluded from the drops', async () => {
    const plan = await resolvePushPlan({
      candidates: [cand],
      orphans,
      flagRenames: [cand],
      force: true,
      interactive: false
    })
    expect(plan.renames).toEqual([cand])
    expect(plan.dropColumns).toEqual([{table: 'u', column: 'junk'}]) // `name` was renamed, not dropped
  })

  it('non-interactive never drops — it keeps everything and emits re-run hints', async () => {
    const plan = await resolvePushPlan({
      candidates: [cand],
      orphans,
      flagRenames: [],
      force: false,
      interactive: false
    })
    expect(plan.dropColumns).toEqual([])
    expect(plan.warnings).toHaveLength(2)
    expect(plan.warnings[0]).toMatch(/possible rename u\.name → full_name/)
    expect(plan.warnings[0]).toMatch(/--rename u\.name=u\.full_name/)
    expect(plan.warnings[1]).toMatch(/orphan column u\.junk kept/)
  })

  it('interactive asks per orphan and honours rename / drop / keep', async () => {
    const seen: Array<{col: string; hasCandidate: boolean}> = []
    const answers: Record<string, OrphanDecision> = {name: 'rename', junk: 'drop'}
    const plan = await resolvePushPlan(
      {candidates: [cand], orphans, flagRenames: [], force: false, interactive: true},
      async (o, candidate) => {
        seen.push({col: o.column, hasCandidate: !!candidate})
        return answers[o.column]
      }
    )
    // `name` → rename (candidate offered), `junk` → drop (no candidate offered).
    expect(seen).toEqual([
      {col: 'name', hasCandidate: true},
      {col: 'junk', hasCandidate: false}
    ])
    expect(plan.renames).toEqual([cand])
    expect(plan.dropColumns).toEqual([{table: 'u', column: 'junk'}])
  })

  it('interactive "keep" leaves a column alone (neither renamed nor dropped)', async () => {
    const plan = await resolvePushPlan(
      {candidates: [cand], orphans, flagRenames: [], force: false, interactive: true},
      async () => 'keep'
    )
    expect(plan.renames).toEqual([])
    expect(plan.dropColumns).toEqual([])
  })
})
