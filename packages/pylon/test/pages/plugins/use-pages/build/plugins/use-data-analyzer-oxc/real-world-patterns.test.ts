import {describe, expect, it} from 'vitest'
import {analyzeFiles, select} from './_harness'

// A grid component (like the app's DataGridVirtual): per row, per column, either call
// the cell closure or read row[col.accessorKey]; and invoke rowActions(row) per row.
const GRID = `import React from 'react'
  export function Grid({ rows, columns, rowActions }: any) {
    return <div>{rows.map((row: any) => (
      <div key={row.id}>
        {columns.map((col: any) => col.cell ? col.cell(row) : String(row[col.accessorKey] ?? ''))}
        {(rowActions ? rowActions(row) : []).map((a: any, i: number) => <button key={i} onClick={a.onClick}>{a.label}</button>)}
      </div>
    ))}</div>
  }`

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

describe('oxc analyzer · data-grid patterns', () => {
  const columns = `React.useMemo(() => [
    { id: 'n', accessorKey: 'name' },
    { id: 'e', accessorKey: 'email', cell: (u: any) => u.avatarUrl },
  ], [])`

  it('reads accessorKey columns AND cell closures across a whole grid (union of literal keys)', () => {
    // `col` ranges over the config array, so `col.accessorKey` is the union of every
    // column key: `row[col.accessorKey]` must fan out to read each one.
    const page = `import { useData } from '@getcronit/pylon/pages'
      import React from 'react'
      import { Grid } from './Grid'
      export default function P() {
        const data = useData()
        const columns = ${columns}
        return <Grid rows={data.users} columns={columns} />
      }`
    expect(analyzeFiles({'P.tsx': page, 'Grid.tsx': GRID}, 'P.tsx')[0]).toEqual({
      // `id` comes from the grid's `key={row.id}`.
      users: {__isList: true, id: true, name: true, email: true, avatarUrl: true}
    })
  })

  it('threads the row into a rowActions(row) callback body (like `doc.media.id`)', () => {
    const page = `import { useData } from '@getcronit/pylon/pages'
      import React from 'react'
      import { Grid } from './Grid'
      export default function P() {
        const data = useData()
        const columns = ${columns}
        const rowActions = React.useCallback((item: any) => {
          const prof = item.profile
          return [{ label: 'x', onClick: () => void prof }]
        }, [])
        return <Grid rows={data.users} columns={columns} rowActions={rowActions} />
      }`
    expect(analyzeFiles({'P.tsx': page, 'Grid.tsx': GRID}, 'P.tsx')[0]).toMatchObject({
      users: {profile: {}}
    })
  })

  it('threads the row through a rowActions onClick into a handler (like `handleDownload(item)`)', () => {
    const page = `import { useData } from '@getcronit/pylon/pages'
      import React from 'react'
      import { Grid } from './Grid'
      export default function P() {
        const data = useData()
        const columns = ${columns}
        const download = React.useCallback((item: any) => { if (item.avatarUrl) open(item.avatarUrl) }, [])
        const rowActions = React.useCallback((item: any) => {
          return [{ label: 'dl', onClick: () => download(item) }]
        }, [])
        return <Grid rows={data.users} columns={columns} rowActions={rowActions} />
      }`
    expect(analyzeFiles({'P.tsx': page, 'Grid.tsx': GRID}, 'P.tsx')[0]).toMatchObject({
      users: {avatarUrl: true}
    })
  })
})
