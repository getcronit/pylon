import {describe, expect, it} from 'vitest'
import {useDataOxcVite} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/index'
import {schema} from './_schema'

const PAGE = (field: string) =>
  `import { useData } from '@getcronit/pylon/pages'
   export default function Page() {
     const data = useData()
     return <div>{data.me.${field}}</div>
   }`

function mockServer() {
  const invalidated: string[] = []
  const mod = {id: '\0pylon-docs:/app/Page.tsx'}
  return {
    invalidated,
    server: {
      moduleGraph: {
        getModuleById: (id: string) => (id === mod.id ? mod : undefined),
        invalidateModule: (m: {id: string}) => invalidated.push(m.id)
      }
    }
  }
}

describe('oxc analyzer · vite HMR sidecar invalidation', () => {
  it('invalidates the virtual sidecar only when the compiled docs change', () => {
    const plugin: any = useDataOxcVite({schema})
    const {server, invalidated} = mockServer()
    plugin.configureServer(server)

    const run = (src: string) => plugin.transform(src, '/app/Page.tsx')

    run(PAGE('name')) // first compile → sidecar created → invalidate
    expect(invalidated).toEqual(['\0pylon-docs:/app/Page.tsx'])

    run(PAGE('email')) // selection changed → sidecar changes → invalidate again
    expect(invalidated).toHaveLength(2)

    run(PAGE('email')) // identical → sidecar unchanged → no invalidation
    expect(invalidated).toHaveLength(2)
  })

  it('rewrites the page to import the (updated) sidecar doc', () => {
    const plugin: any = useDataOxcVite({schema})
    plugin.configureServer(mockServer().server)
    const out = plugin.transform(PAGE('email'), '/app/Page.tsx')
    expect(out.code).toContain('from "pylon-docs:/app/Page.tsx"')
    expect(out.code).toMatch(/useData\(__pylonDoc_Page_0/)
  })
})
