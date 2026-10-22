import {describe, expect, it} from 'vitest'
import {analyzeFiles} from './_harness'

describe('oxc analyzer · resolution edge cases', () => {
  it('unwraps a generic custom HOC on a default export', () => {
    const files = {
      'Row.tsx': `function Base({ item }: any) { return <span>{item.name}{item.email}</span> }
        function withAuth(C: any) { return C }
        export default withAuth(Base)`,
      'Page.tsx': `import { useData } from '@getcronit/pylon/pages'
        import Row from './Row'
        export default function Page() { const data = useData(); return <Row item={data.me} /> }`
    }
    expect(analyzeFiles(files, 'Page.tsx')[0]).toEqual({me: {name: true, email: true}})
  })

  it('resolves a component accessed through a namespace import', () => {
    const files = {
      'ui.tsx': `export function Row({ item }: any) { return <span>{item.name}</span> }`,
      'Page.tsx': `import { useData } from '@getcronit/pylon/pages'
        import * as UI from './ui'
        export default function Page() { const data = useData(); return <UI.Row item={data.me} /> }`
    }
    expect(analyzeFiles(files, 'Page.tsx')[0]).toEqual({me: {name: true}})
  })
})
