import {describe, expect, it} from 'vitest'
import {analyzeFiles} from './_harness'

/**
 * Closure-config (higher-order) dataflow: a config array/object of accessor
 * closures `(row) => row.field` is prop-drilled into a generic component that
 * invokes them (`col.get(row)`). The data reads live INSIDE the closures, reached
 * only by connecting "this member is the arrow" with "it's called with the row".
 *
 * These are the currently-failing target cases for the closure-config work.
 */
const analyze1 = (src: string) => analyzeFiles({'Page.tsx': src}, 'Page.tsx')[0]

describe('oxc analyzer · closure-config (higher-order) dataflow', () => {
  it('traces accessor closures invoked deep in a cell', () => {
    const src = `import { useData } from '@getcronit/pylon/pages'
      function Cell({ col, row }: any) { return <span>{col.get(row)}</span> }
      function Grid({ rows, cols }: any) {
        return <div>{rows.map((r: any) => cols.map((c: any) => <Cell col={c} row={r} />))}</div>
      }
      export default function Page() {
        const data = useData()
        const cols = [{ get: (u: any) => u.name }, { get: (u: any) => u.email }]
        return <Grid rows={data.users} cols={cols} />
      }`
    expect(analyze1(src)).toEqual({users: {__isList: true, name: true, email: true}})
  })

  it('follows an accessor that calls a shared helper', () => {
    const src = `import { useData } from '@getcronit/pylon/pages'
      function label(u: any) { return u.name }
      function Cell({ col, row }: any) { return <span>{col.get(row)}</span> }
      function Grid({ rows, cols }: any) {
        return <div>{rows.map((r: any) => <Cell col={cols[0]} row={r} />)}</div>
      }
      export default function Page() {
        const data = useData()
        const cols = [{ get: (u: any) => label(u) }]
        return <Grid rows={data.users} cols={cols} />
      }`
    expect(analyze1(src)).toEqual({users: {__isList: true, name: true}})
  })

  it('follows an accessor that reads a nested object path', () => {
    const src = `import { useData } from '@getcronit/pylon/pages'
      function Cell({ col, row }: any) { return <span>{col.get(row)}</span> }
      function Grid({ rows, cols }: any) {
        return <div>{rows.map((r: any) => <Cell col={cols[0]} row={r} />)}</div>
      }
      export default function Page() {
        const data = useData()
        const cols = [{ get: (u: any) => u.profile.address.city }]
        return <Grid rows={data.users} cols={cols} />
      }`
    expect(analyze1(src)).toEqual({
      users: {__isList: true, profile: {address: {city: true}}}
    })
  })

  it('handles a heterogeneous switch cell (the real grid pattern)', () => {
    const src = `import { useData } from '@getcronit/pylon/pages'
      function Cell({ col, row }: any) {
        switch (col.type) {
          case 'text': return <span>{col.value(row)}</span>
          case 'entity': return <b>{col.title(row)}</b>
          default: return null
        }
      }
      function Grid({ rows, cols }: any) {
        return <div>{rows.map((r: any) => cols.map((c: any) => <Cell col={c} row={r} />))}</div>
      }
      export default function Page() {
        const data = useData()
        const cols = [
          { type: 'text', value: (u: any) => u.email },
          { type: 'entity', title: (u: any) => u.name }
        ]
        return <Grid rows={data.users} cols={cols} />
      }`
    expect(analyze1(src)).toEqual({users: {__isList: true, email: true, name: true}})
  })
})

describe('oxc analyzer · closure-config across files', () => {
  it('traces accessor closures through imported Grid/Cell components', () => {
    const files = {
      'Cell.tsx': `export function Cell({ col, row }: any) { return <span>{col.get(row)}</span> }`,
      'Grid.tsx': `import { Cell } from './Cell'
        export function Grid({ rows, cols }: any) {
          return <div>{rows.map((r: any) => cols.map((c: any) => <Cell col={c} row={r} />))}</div>
        }`,
      'Page.tsx': `import { useData } from '@getcronit/pylon/pages'
        import { Grid } from './Grid'
        export default function Page() {
          const data = useData()
          const cols = [{ get: (u: any) => u.name }, { get: (u: any) => u.email }]
          return <Grid rows={data.users} cols={cols} />
        }`
    }
    expect(analyzeFiles(files, 'Page.tsx')[0]).toEqual({
      users: {__isList: true, name: true, email: true}
    })
  })

  it('resolves a closure that captures a helper from its defining (Page) scope', () => {
    // The accessor is invoked inside imported Cell, but `label` lives in Page —
    // the closure must resolve free vars against ITS defining scope, not Cell's.
    const files = {
      'Cell.tsx': `export function Cell({ col, row }: any) { return <span>{col.get(row)}</span> }`,
      'Grid.tsx': `import { Cell } from './Cell'
        export function Grid({ rows, cols }: any) {
          return <div>{rows.map((r: any) => <Cell col={cols[0]} row={r} />)}</div>
        }`,
      'Page.tsx': `import { useData } from '@getcronit/pylon/pages'
        import { Grid } from './Grid'
        function label(u: any) { return u.profile.address.city }
        export default function Page() {
          const data = useData()
          const cols = [{ get: (u: any) => label(u) }]
          return <Grid rows={data.users} cols={cols} />
        }`
    }
    expect(analyzeFiles(files, 'Page.tsx')[0]).toEqual({
      users: {__isList: true, profile: {address: {city: true}}}
    })
  })
})
