import {describe, expect, it} from 'vitest'
import {createOxcAnalyzerCore} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/index'
import {analyzeFiles} from './_harness'
import {schema} from './_schema'

const core = () => createOxcAnalyzerCore({schema})
const sidecarOf = (c: ReturnType<typeof core>, id: string) =>
  c.loadSidecar('\0pylon-docs:' + id)!

describe('oxc analyzer · op.query / op.mutation', () => {
  it('traces the callback param as the query root', () => {
    const src = `import { op } from '@getcronit/pylon/pages'
      export async function load() {
        return await op.query(q => q.user({ id: "1" }).name)
      }`
    expect(analyzeFiles({'L.ts': src}, 'L.ts')).toContainEqual({
      user: {__args: '{ id: "1" }', name: true}
    })
  })

  it('emits a query document and keeps the projection callback', () => {
    const c = core()
    const src = `import { op } from '@getcronit/pylon/pages'
      export async function load() {
        return await op.query(q => q.me.email)
      }`
    const out = c.transformPage('/app/L.ts', src)!
    expect(out).toMatch(/op\.query\(__pylonDoc_L_0, [^,]+, q => q\.me\.email\)/)
    const s = sidecarOf(c, '/app/L.ts')
    expect(s).toContain('me { email')
  })
})

describe('oxc analyzer · useMutation', () => {
  it('emits a mutation document from a string field name', () => {
    const c = core()
    const src = `import { useMutation } from '@getcronit/pylon/pages'
      export default function P() {
        const [createUser] = useMutation('createUser')
        return null as any
      }`
    const out = c.transformPage('/app/M.tsx', src)!
    expect(out).toContain('useMutation(__pylonDoc_M_0)')
    const s = sidecarOf(c, '/app/M.tsx')
    expect(s).toContain('rootField: "createUser"')
    expect(s).toContain('createUser(')
    expect(s).toMatch(/mutation M_0/)
  })

  it('adds nested relations read off the awaited trigger result', () => {
    const c = core()
    const src = `import { useMutation } from '@getcronit/pylon/pages'
      export default function P() {
        const [createUser] = useMutation('createUser')
        async function onSubmit() {
          const u = await createUser({ name: "x" })
          u.posts.map(p => p.title)
        }
        return <button onClick={onSubmit}>go</button>
      }`
    c.transformPage('/app/MN.tsx', src)
    const s = sidecarOf(c, '/app/MN.tsx')
    // allScalars of User plus the nested relation the trigger result reads.
    expect(s).toContain('createUser(')
    expect(s).toContain('posts {')
    expect(s).toContain('title')
  })

  it('accepts the selector form m => m.field', () => {
    const c = core()
    const src = `import { useMutation } from '@getcronit/pylon/pages'
      export default function P() {
        const [pub] = useMutation(m => m.publishPost)
        return null as any
      }`
    const out = c.transformPage('/app/M2.tsx', src)!
    expect(out).toContain('useMutation(__pylonDoc_M2_0)')
    expect(sidecarOf(c, '/app/M2.tsx')).toContain('rootField: "publishPost"')
  })
})

describe('oxc analyzer · usePaginatedData', () => {
  it('emits a connection document from selector path + result reads', () => {
    const c = core()
    const src = `import { usePaginatedData } from '@getcronit/pylon/pages'
      export default function P() {
        const c = usePaginatedData(q => q.posts, { first: 10 })
        return <ul>{c.edges.map(e => <li>{e.node.title}</li>)}</ul>
      }`
    const out = c.transformPage('/app/Feed.tsx', src)!
    expect(out).toMatch(/usePaginatedData\(__pylonDoc_Feed_0,/)
    // the original selector arg is replaced; the user args are preserved
    expect(out).toContain('{ first: 10 }')
    const s = sidecarOf(c, '/app/Feed.tsx')
    expect(s).toContain('posts(')
    expect(s).toContain('edges')
    expect(s).toContain('node { title')
    expect(s).toContain('connection')
  })

  it('handles a nested connection path with intermediate args', () => {
    const c = core()
    const src = `import { usePaginatedData } from '@getcronit/pylon/pages'
      export default function P() {
        const c = usePaginatedData(q => q.post({ id: "1" }).related)
        return <ul>{c.edges.map(e => <li>{e.node.title}</li>)}</ul>
      }`
    const out = c.transformPage('/app/Thread.tsx', src)!
    const s = sidecarOf(c, '/app/Thread.tsx')
    expect(s).toContain('post(id: $v0)')
    expect(s).toContain('related(')
    expect(s).toContain('node { title')
  })
})
