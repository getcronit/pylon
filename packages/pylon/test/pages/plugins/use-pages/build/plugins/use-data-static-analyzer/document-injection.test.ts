import {buildSchema} from 'graphql'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {runAnalyzer} from './_run-analyzer'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    user(id: ID!): User
    me: User
    feed(first: Int, after: String, category: String): FeedConnection!
  }
  type Mutation {
    createUser(name: String!): User!
  }
  type User {
    id: ID!
    name: String
    email: String
    posts: [Post!]!
  }
  type Post {
    id: ID!
    title: String
  }
  type FeedConnection {
    edges: [FeedEdge!]!
    pageInfo: PageInfo!
    totalCount: Int
  }
  type FeedEdge {
    cursor: String!
    node: Post!
  }
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }
`)

const tempDir = path.join(os.tmpdir(), 'pylon-doc-injection')

async function transform(code: string): Promise<string> {
  const filePath = path.join(tempDir, `c${Math.random().toString(36).slice(2)}.tsx`)
  fs.writeFileSync(filePath, code)
  return await runAnalyzer(filePath, {schema})
}

describe('analyzer document injection (schema present)', () => {
  beforeAll(() => fs.mkdirSync(tempDir, {recursive: true}))
  afterAll(() => fs.rmSync(tempDir, {recursive: true, force: true}))

  it('injects a doc + variables thunk and imports doc', async () => {
    const out = await transform(`
      import { useData } from "@getcronit/pylon/pages";
      export function Component() {
        const id = "1";
        const data = useData();
        return <div>{data.user({ id }).name}</div>;
      }
    `)
    expect(out).toContain('import { doc as __pylonDoc }')
    // The analyzer's raw TS output keeps the doc factory's type param
    // (`__pylonDoc<{…}>(…)`); the old esbuild harness stripped it to `__pylonDoc(`.
    expect(out).toContain('__pylonDoc<')
    expect(out).toContain('user(id: $v0)')
    // The call now takes the doc + a variables thunk.
    expect(out).toMatch(/useData\(__pylonDoc_\w+_0,\s*\(\)\s*=>/)
    expect(out).toContain('v0: id')
  })

  it('keeps existing options as the third argument', async () => {
    const out = await transform(`
      import { useData } from "@getcronit/pylon/pages";
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

  it('injects a mutation document for useMutation(m => m.field)', async () => {
    const out = await transform(`
      import { useMutation } from "@getcronit/pylon/pages";
      export function Form() {
        const [createUser, state] = useMutation(m => m.createUser);
        return <button onClick={() => createUser({ name: 'Ada' })}>create</button>;
      }
    `)
    // Compiled mutation: runtime arg + allScalars + id + __typename.
    expect(out).toContain('createUser(name: $name)')
    expect(out).toContain('id name email __typename')
    expect(out).toContain('rootField')
    // The selector is replaced by the document.
    expect(out).toMatch(/useMutation\(__pylonDoc_\w+_0\)/)
  })

  it('augments a mutation with analyze(triggerReturn) nested reads', async () => {
    const out = await transform(`
      import { useMutation } from "@getcronit/pylon/pages";
      export function Form() {
        const [createUser] = useMutation(m => m.createUser);
        async function onClick() {
          const u = await createUser({ name: 'Ada' });
          u.posts.map(p => p.title);
        }
        return <button onClick={onClick}>create</button>;
      }
    `)
    // allScalars (id name email) ∪ analyzed nested (posts { title }) ∪ {id,__typename}
    expect(out).toContain('id name email')
    expect(out).toContain('posts { title __typename id }')
  })

  it('injects a mutation document from a string key', async () => {
    const out = await transform(`
      import { useMutation } from "@getcronit/pylon/pages";
      export function Form() {
        const [createUser, state] = useMutation('createUser');
        return <button onClick={() => createUser({ name: 'Ada' })}>create</button>;
      }
    `)
    expect(out).toContain('createUser(name: $name)')
    expect(out).toContain('id name email')
    expect(out).toMatch(/useMutation\(__pylonDoc_\w+_0\)/)
  })

  it('injects a connection document from a usePaginatedData chain selector', async () => {
    const out = await transform(`
      import { usePaginatedData } from "@getcronit/pylon/pages";
      export function Page() {
        const feed = usePaginatedData(q => q.feed, { category: 'tech' });
        return <ul>{feed.nodes.map(n => <li key={n.id}>{n.title}</li>)}</ul>;
      }
    `)
    // pagination args hook-managed; base arg `category` declared by name
    expect(out).toContain('feed(first: $p_first, after: $p_after, category: $category)')
    expect(out).toMatch(/node \{[^}]*title[^}]*__typename[^}]*\}/)
    // selector replaced by the document; user args preserved as 3rd arg
    expect(out).toMatch(/usePaginatedData\(__pylonDoc_\w+_0,\s*(undefined|void 0),\s*\{ category: ["']tech["'] \}\)/)
  })

  it('injects a query document for op.query(q => …) and keeps the projection', async () => {
    const out = await transform(`
      import { op } from "@getcronit/pylon/pages";
      export async function loadUser(id: string) {
        const user = await op.query(q => q.user({ id }).name);
        return user;
      }
    `)
    expect(out).toContain('user(id: $v0)')
    expect(out).toContain('name')
    // op.query(cb) → op.query(doc, thunk, cb): doc + variables thunk + kept cb.
    expect(out).toMatch(/op\.query\(__pylonDoc_\w+_0,\s*\(\)\s*=>/)
    expect(out).toContain('v0: id')
    // The original selector is kept as the trailing projection argument.
    expect(out).toMatch(/\(?q\)?\s*=>\s*q\.user/)
  })

  it('analyzes a block-body op.query callback (intermediate const + return)', async () => {
    const out = await transform(`
      import { op } from "@getcronit/pylon/pages";
      export async function fetchUser(id: string) {
        const user = await op.query(q => {
          const u = q.user({ id });
          return { name: u.name, email: u.email };
        });
        return user;
      }
    `)
    expect(out).toContain('user(id: $v0)')
    expect(out).toMatch(/name[\s\S]*email|email[\s\S]*name/)
    expect(out).toMatch(/op\.query\(__pylonDoc_\w+_0,/)
  })

  it('analyzes a destructured-root op.query callback (({user}) => …)', async () => {
    const out = await transform(`
      import { op } from "@getcronit/pylon/pages";
      export async function loadUser(id: string) {
        const user = await op.query(({ user }) => user({ id }).name);
        return user;
      }
    `)
    expect(out).toContain('user(id: $v0)')
    expect(out).toContain('name')
    expect(out).toContain('v0: id')
    // Rewritten like the single-param form; the original destructured selector is kept.
    expect(out).toMatch(/op\.query\(__pylonDoc_\w+_0,/)
    expect(out).toMatch(/\(\{\s*user\s*\}\)\s*=>\s*user/)
  })

  it('analyzes a destructured-root op.query with an alias (({user: u}) => …)', async () => {
    const out = await transform(`
      import { op } from "@getcronit/pylon/pages";
      export async function loadEmail(id: string) {
        return await op.query(({ user: u }) => u({ id }).email);
      }
    `)
    expect(out).toContain('user(id: $v0)')
    expect(out).toContain('email')
    expect(out).toMatch(/op\.query\(__pylonDoc_\w+_0,/)
  })

  it('injects a mutation document for op.mutation(m => …)', async () => {
    const out = await transform(`
      import { op } from "@getcronit/pylon/pages";
      export async function create(name: string) {
        const res = await op.mutation(m => m.createUser({ name }));
        return res;
      }
    `)
    // Closure arg (like op.query), not a runtime trigger arg.
    expect(out).toContain('createUser(name: $v0)')
    // Bare object return → fillObjectLeaves expands to allScalars of the result.
    expect(out).toContain('id name email')
    expect(out).toMatch(/op\.mutation\(__pylonDoc_\w+_0,/)
  })

  it('fails loud on an unknown field', async () => {
    await expect(
      transform(`
        import { useData } from "@getcronit/pylon/pages";
        export function Component() {
          const data = useData();
          return <div>{data.me.nope}</div>;
        }
      `)
    ).rejects.toThrow(/does not exist/)
  })
})
