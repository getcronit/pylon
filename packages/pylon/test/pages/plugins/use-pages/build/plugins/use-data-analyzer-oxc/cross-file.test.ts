import {describe, expect, it} from 'vitest'
import {analyzeFiles} from './_harness'

const PAGE = (body: string, imports = '') =>
  `import { useData } from '@getcronit/pylon/pages'\n${imports}\n` +
  `export default function Page() {\n  const data = useData()\n  ${body}\n}\n`

describe('oxc analyzer · cross-file propagation', () => {
  it('pulls element reads out of an imported component via a prop', () => {
    const files = {
      'Row.tsx': `export default function Row({ item }: any) {
        return <span>{item.name} {item.avatarUrl}</span>
      }`,
      'Page.tsx': PAGE(
        `return <Row item={data.user({ id: "1" })} />`,
        `import Row from './Row'`
      )
    }
    expect(analyzeFiles(files, 'Page.tsx')[0]).toEqual({
      user: {__args: '{ id: "1" }', name: true, avatarUrl: true}
    })
  })

  it('folds a component that takes the whole props object (not destructured)', () => {
    const files = {
      'Grid.tsx': `export default function Grid(props: any) {
        return <div>{props.rows.map((r: any) => <span>{r.name}{r.email}</span>)}</div>
      }`,
      'Page.tsx': PAGE(
        `return <Grid rows={data.users} />`,
        `import Grid from './Grid'`
      )
    }
    expect(analyzeFiles(files, 'Page.tsx')[0]).toEqual({
      users: {__isList: true, name: true, email: true}
    })
  })

  it('resolves a component imported through a barrel re-export', () => {
    const files = {
      'components/Row.tsx': `export function Row({ item }: any) {
        return <span>{item.email}</span>
      }`,
      'components/index.ts': `export { Row } from './Row'`,
      'Page.tsx': PAGE(
        `return <Row item={data.me} />`,
        `import { Row } from './components'`
      )
    }
    expect(analyzeFiles(files, 'Page.tsx')[0]).toEqual({me: {email: true}})
  })

  it('sees through React.memo wrapping', () => {
    const files = {
      'Row.tsx': `import { memo } from 'react'
        function RowInner({ item }: any) { return <span>{item.name}</span> }
        export default memo(RowInner)`,
      'Page.tsx': PAGE(
        `return <Row item={data.me} />`,
        `import Row from './Row'`
      )
    }
    expect(analyzeFiles(files, 'Page.tsx')[0]).toEqual({me: {name: true}})
  })

  it('drills a connection through multiple component levels', () => {
    const files = {
      'Row.tsx': `export default function Row({ row }: any) {
        return <span>{row.name}</span>
      }`,
      'List.tsx': `import Row from './Row'
        export default function List({ items }: any) {
          return <ul>{items.map((u: any) => <Row row={u} />)}</ul>
        }`,
      'Page.tsx': PAGE(
        `return <List items={data.users} />`,
        `import List from './List'`
      )
    }
    expect(analyzeFiles(files, 'Page.tsx')[0]).toEqual({
      users: {__isList: true, name: true}
    })
  })

  it('follows a custom hook (in another file) that returns seed data', () => {
    const files = {
      'hooks.ts': `import { useData } from '@getcronit/pylon/pages'
        export function useMe() { const data = useData(); return data.me }`,
      'Page.tsx':
        `import { useMe } from './hooks'\n` +
        `export default function Page() {\n  const me = useMe()\n  return <span>{me.email}</span>\n}\n`
    }
    // The seed lives in hooks.ts; its selection is what the page reads back.
    expect(analyzeFiles(files, 'Page.tsx')).toContainEqual({me: {email: true}})
  })
})
