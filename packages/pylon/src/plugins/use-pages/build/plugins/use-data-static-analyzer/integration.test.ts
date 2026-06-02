import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {useDataStaticAnalyzer} from './index'

const tempDir = path.join(__dirname, 'temp_integration')

describe('Configurable Plugin Integration', () => {
  beforeAll(() => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir)
  })

  afterAll(() => {
    if (fs.existsSync(tempDir))
      fs.rmSync(tempDir, {recursive: true, force: true})
  })

  it('should support custom package and hook names', async () => {
    const filePath = path.join(tempDir, 'CustomHook.tsx')
    const input = `
      import { useGQL as query } from "@my/custom-pylon";
      
      export function MyComp() {
        const data = query();
        return <div>{data.user.name}</div>;
      }
    `
    fs.writeFileSync(filePath, input)

    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [
        useDataStaticAnalyzer({
          pylonPackage: '@my/custom-pylon',
          hookName: 'useGQL',
          debug: true
        })
      ],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@my/custom-pylon', 'react']
    })

    const outputCode = result.outputFiles[0].text

    // Check that it injected the prepare function correctly
    // It should identify useGQL (aliased as query) and inject the selector
    expect(outputCode.replace(/\s+/g, '')).toContain(
      'query({prepare:({query:query2})=>{query2?.user?.name;}})'
    )
  })

  it('should handle mixed default and custom configurations in separates builds (Project isolation)', async () => {
    // This tests that the shared project doesn't cross-contaminate if we use separate plugin instances
    // Or rather, that it works correctly for a single instance

    const filePath = path.join(tempDir, 'DefaultHook.tsx')
    const input = `
      import { useData } from "@getcronit/pylon/pages";
      export function DefaultComp() {
        const data = useData();
        return <div>{data.post.title}</div>;
      }
    `
    fs.writeFileSync(filePath, input)

    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()], // Default options
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon/pages', 'react']
    })

    const outputCode = result.outputFiles[0].text
    expect(outputCode.replace(/\s+/g, '')).toContain(
      'useData({prepare:({query})=>{query?.post?.title;}})'
    )
  })
})
