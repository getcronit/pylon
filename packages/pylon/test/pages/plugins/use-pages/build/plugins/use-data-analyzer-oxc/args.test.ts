import {describe, expect, it} from 'vitest'
import {analyzeFiles, select} from './_harness'

describe('oxc analyzer · field arguments', () => {
  it('captures the argument source for a field call', () => {
    expect(select('const n = data.user({ id: "1" }).name')).toEqual({
      user: {__args: '{ id: "1" }', name: true}
    })
  })

  it('keeps an argument that references a local variable verbatim', () => {
    expect(
      select('const uid = props.userId; const n = data.user({ id: uid }).name')
    ).toEqual({user: {__args: '{ id: uid }', name: true}})
  })

  it('marks a zero-argument call distinctly from a property access', () => {
    expect(select('const t = data.posts().totalCount')).toEqual({
      posts: {__args: '', totalCount: true}
    })
  })

  it('threads an argument supplied as a prop from a parent component', () => {
    const files = {
      'Child.tsx': `import { useData } from '@getcronit/pylon/pages'
        export default function Child({ userId }: any) {
          const data = useData()
          return <span>{data.user({ id: userId }).email}</span>
        }`,
      'Page.tsx': `import Child from './Child'
        export default function Page() { return <Child userId={"42"} /> }`
    }
    expect(analyzeFiles(files, 'Page.tsx')).toContainEqual({
      user: {__args: '{ id: userId }', email: true}
    })
  })
})
