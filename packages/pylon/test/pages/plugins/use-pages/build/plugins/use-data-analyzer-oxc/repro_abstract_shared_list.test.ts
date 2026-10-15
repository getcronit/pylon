import {describe, expect, it} from 'vitest'
import {createOxcAnalyzerCore} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/index'
import {analyzeFiles} from './_harness'
import {schema} from './_schema'

/**
 * Two members of an abstract type (AlphaReport / BetaReport, both implementing the
 * `Report` interface) each declare a same-named LIST field `rows` whose element
 * OBJECT type differs: AlphaRow {label, tag, amount, score} vs BetaRow {note, amount}.
 *
 * Narrowing to AlphaReport and reading its rows fields must keep AlphaRow's OWN
 * fields — it must NOT collapse to AlphaRow ∩ BetaRow = {amount}, across any read
 * position (call-arg / logical-OR / ternary-test / binary-compare).
 *
 * Regression for lokalis `AccountingReportResult`, where `AccountLedger.rows` came
 * back as `{ debit credit }` (= TrialBalanceRow ∩ AccountLedgerRow), dropping
 * date/documentRef/text/contra/balance.
 */
const page = (body: string) =>
  `import { useData } from '@getcronit/pylon/pages'
   export default function P(props: any) {
     const data = useData()
     ${body}
     return null as any
   }`
const sel = (body: string) => analyzeFiles({'P.tsx': page(body)}, 'P.tsx')[0]
const compile = (body: string) => {
  const c = createOxcAnalyzerCore({schema})
  c.transformPage('/app/P.tsx', page(body))
  return c.loadSidecar('\0pylon-docs:/app/P.tsx')!
}

// Narrow to AlphaReport (declared FIRST) and read AlphaRow fields in every syntactic
// position.
const ALPHA = `
  const report = props.show ? data.report({ kind: "alpha" }) : null
  const alpha = report && report.__typename === "AlphaReport" ? report : null
  const rows = alpha?.rows ?? []
  rows.map((x: any) => {
    const l = fmtDate(x.label)       // call-arg
    const t = x.tag || "—"           // logical-OR left operand
    const a = x.amount ? "y" : "n"   // ternary test
    const s = x.score < 0            // binary compare
    return [l, t, a, s]
  })
`

// Narrow to BetaReport (declared SECOND). Its element type BetaRow is NOT the first
// member's rows type, so before the fix `note` was validated against AlphaRow (the
// first member visited) and silently dropped — the regression this guards.
const BETA = `
  const report = props.show ? data.report({ kind: "beta" }) : null
  const beta = report && report.__typename === "BetaReport" ? report : null
  const rows = beta?.rows ?? []
  rows.map((x: any) => [x.note || "—", x.amount])
`

describe('oxc analyzer · abstract-type shared list field', () => {
  it('records the FIRST member\'s row fields (every read position)', () => {
    expect(sel(ALPHA)).toMatchObject({
      report: {rows: {label: true, tag: true, amount: true, score: true}}
    })
  })

  it('records a NON-first member\'s own row field (no collapse to the row-type intersection)', () => {
    // `note` is BetaRow-only; without the union fix it is dropped (validated against AlphaRow).
    expect(sel(BETA)).toMatchObject({report: {rows: {note: true, amount: true}}})
  })

  it('compiles each member\'s rows fragment with its OWN fields', () => {
    const a = compile(ALPHA).match(/on AlphaReport \{[\s\S]*?rows[^{]*\{([^}]*)\}/)?.[1] ?? ''
    for (const f of ['label', 'tag', 'amount', 'score']) expect(a).toContain(f)
    const b = compile(BETA).match(/on BetaReport \{[\s\S]*?rows[^{]*\{([^}]*)\}/)?.[1] ?? ''
    expect(b).toContain('note')
  })
})
