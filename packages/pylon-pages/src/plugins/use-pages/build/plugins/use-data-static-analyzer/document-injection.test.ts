import {buildSchema} from 'graphql'
import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {useDataStaticAnalyzer} from './index'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    user(id: ID!): User
    me: User
  }
  type User {
    id: ID!
    name: String
    email: String
  }
`)

const tempDir = path.join(os.tmpdir(), 'pylon-doc-injection')

async function transform(code: string): Promise<string> {
  const filePath = path.join(tempDir, `c${Math.random().toString(36).slice(2)}.tsx`)
  fs.writeFileSync(filePath, code)
  const result = await esbuild.build({
    entryPoints: [filePath],
    plugins: [useDataStaticAnalyzer({schema})],
    write: false,
    bundle: true,
    format: 'esm',
    external: ['@getcronit/pylon-pages', '@getcronit/pylon-query']
  })
  return result.outputFiles[0].text
}

describe('analyzer document injection (schema present)', () => {
  beforeAll(() => fs.mkdirSync(tempDir, {recursive: true}))
  afterAll(() => fs.rmSync(tempDir, {recursive: true, force: true}))

  it('injects a doc + variables thunk and imports doc', async () => {
    const out = await transform(`
      import { useData } from "@getcronit/pylon-pages";
      export function Component() {
        const id = "1";
        const data = useData();
        return <div>{data.user({ id }).name}</div>;
      }
    `)
    expect(out).toContain('import { doc as __pylonDoc }')
    expect(out).toContain('__pylonDoc(')
    expect(out).toContain('user(id: $v0)')
    // The call now takes the doc + a variables thunk.
    expect(out).toMatch(/useData\(__pylonDoc_\w+_0,\s*\(\)\s*=>/)
    expect(out).toContain('v0: id')
  })

  it('keeps existing options as the third argument', async () => {
    const out = await transform(`
      import { useData } from "@getcronit/pylon-pages";
      export function Component() {
        const data = useData({ tags: ["x"] });
        return <div>{data.me.name}</div>;
      }
    `)
    // no variables → empty thunk slot (esbuild prints `undefined` as `void 0`),
    // options preserved as the 3rd argument.
    expect(out).toMatch(
      /useData\(__pylonDoc_\w+_0,\s*(undefined|void 0),\s*\{ tags: \["x"\] \}\)/
    )
  })

  it('fails loud on an unknown field', async () => {
    await expect(
      transform(`
        import { useData } from "@getcronit/pylon-pages";
        export function Component() {
          const data = useData();
          return <div>{data.me.nope}</div>;
        }
      `)
    ).rejects.toThrow(/does not exist/)
  })
})
