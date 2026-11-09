import {describe, expect, it} from 'vitest'
import {createOxcAnalyzerCore} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/index'
import {analyzeFiles} from './_harness'
import {schema} from './_schema'

const page = (body: string) =>
  `import { useData } from '@getcronit/pylon/pages'
   export default function P() {
     const data = useData()
     ${body}
     return null as any
   }`
const sel = (body: string) => analyzeFiles({'P.tsx': page(body)}, 'P.tsx')[0]

describe('oxc analyzer · schema features', () => {
  it('reads a field defined on an interface type', () => {
    expect(sel('const n = data.node({ id: "1" }); use(n.id)')).toEqual({
      node: {__args: '{ id: "1" }', id: true}
    })
  })

  it('keeps a field that only a concrete implementer of an interface declares', () => {
    // `title` is on Post (a Node implementer), not on the Node interface itself.
    expect(sel('const n = data.node({ id: "1" }); use(n.id); use(n.title)')).toEqual({
      node: {__args: '{ id: "1" }', id: true, title: true}
    })
  })

  it('distributes union member fields (User.name, Post.title)', () => {
    expect(sel('data.search({ term: "x" }).map((r: any) => [r.name, r.title])')).toEqual({
      search: {__isList: true, __args: '{ term: "x" }', name: true, title: true}
    })
  })

  it('treats an enum field as a scalar leaf', () => {
    expect(sel('use(data.me.role)')).toEqual({me: {role: true}})
  })

  it('compiles a union field into inline fragments', () => {
    const c = createOxcAnalyzerCore({schema})
    const src = page('data.search({ term: "x" }).map((r: any) => [r.name, r.title])')
    c.transformPage('/app/U.tsx', src)
    const body = c.loadSidecar('\0pylon-docs:/app/U.tsx')!
    expect(body).toContain('... on User { name')
    expect(body).toContain('... on Post { title')
  })

  it('emits @inContext with a locale channel when i18n is enabled', () => {
    const c = createOxcAnalyzerCore({schema, inContext: true})
    c.transformPage('/app/L.tsx', page('use(data.me.name)'))
    const body = c.loadSidecar('\0pylon-docs:/app/L.tsx')!
    expect(body).toContain('@inContext(locale: $__locale')
  })
})
