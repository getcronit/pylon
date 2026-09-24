import {describe, expect, it} from 'vitest'
import {analyzeFiles, select} from './_harness'

/**
 * Patterns found on real (lokalis) pages that the analyzer must handle — each was a
 * systemic under-selection until fixed. Regression guards.
 */
describe('oxc analyzer · real-world patterns', () => {
  it('useMemo returns its memoized value (a columns config with cell accessors)', () => {
    const src = `import { useData } from '@getcronit/pylon/pages'
      import { useMemo } from 'react'
      function Grid({ rows, cols }: any) {
        return <div>{rows.map((r: any) => cols.map((c: any) => c.cell(r)))}</div>
      }
      export default function P() {
        const data = useData()
        const cols = useMemo(() => [{ cell: (u: any) => u.name }, { cell: (u: any) => u.email }], [])
        return <Grid rows={data.users} cols={cols} />
      }`
    expect(analyzeFiles({'P.tsx': src}, 'P.tsx')[0]).toEqual({
      users: {__isList: true, name: true, email: true}
    })
  })

  it('React.useMemo is handled the same as bare useMemo', () => {
    const src = `import { useData } from '@getcronit/pylon/pages'
      import React from 'react'
      function Grid({ rows, cols }: any) {
        return <div>{rows.map((r: any) => cols.map((c: any) => c.cell(r)))}</div>
      }
      export default function P() {
        const data = useData()
        const cols = React.useMemo(() => [{ cell: (u: any) => u.avatarUrl }], [])
        return <Grid rows={data.users} cols={cols} />
      }`
    expect(analyzeFiles({'P.tsx': src}, 'P.tsx')[0]).toEqual({
      users: {__isList: true, avatarUrl: true}
    })
  })

  it('reads inside a `new Date(...)` argument', () => {
    expect(select('const d = new Date(data.me.email); use(d)')).toEqual({me: {email: true}})
  })

  it('reads inside a conditional test (`x.role === … ? … : …`)', () => {
    expect(select('const label = data.me.role === "ADMIN" ? "a" : "b"; use(label)')).toEqual({
      me: {role: true}
    })
  })

  it('reads a computed-index expression (`LABELS[row.role]`)', () => {
    expect(select('const L: any = {}; use(L[data.me.role])')).toEqual({me: {role: true}})
  })

  it('resolves a config-driven access (`row[col.accessorKey]`)', () => {
    expect(select('const col = { accessorKey: "name" }; use(data.me[col.accessorKey])')).toEqual({
      me: {name: true}
    })
  })
})
