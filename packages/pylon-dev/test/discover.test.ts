import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  discoverRegistrationModules,
  importStatements
} from '../src/builder/discover'

let root: string
let entry: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-discover-'))
  const src = path.join(root, 'src')
  await fs.mkdir(path.join(src, 'models'), {recursive: true})
  await fs.mkdir(path.join(src, 'queues'), {recursive: true})
  await fs.mkdir(path.join(src, '.pylon'), {recursive: true})
  await fs.mkdir(path.join(src, 'node_modules'), {recursive: true})

  entry = path.join(src, 'index.ts')
  const w = (p: string, c: string) => fs.writeFile(p, c)
  await Promise.all([
    // entry — defines a model, but is EXCLUDED (already loaded)
    w(entry, `import {Model, model} from '@getcronit/pylon-db'\n@model() class Root extends Model {}\nexport default {}`),
    // a model module — discovered
    w(path.join(src, 'models', 'post.ts'), `import {Model, manager, id} from '@getcronit/pylon-db'\n@blog.model() class Post extends Model { static objects = manager(Post); id = id() }`),
    // a queue module — discovered
    w(path.join(src, 'queues', 'publish.ts'), `import {Queue} from '@getcronit/pylon-queues'\n@app.queue() class Publish extends Queue { async process() {} }`),
    // plain util — NOT discovered (no signal)
    w(path.join(src, 'util.ts'), `export const add = (a: number, b: number) => a + b`),
    // an unrelated class named Queue, no pylon import — NOT discovered
    w(path.join(src, 'ring.ts'), `export class Queue<T> { items: T[] = [] }`),
    // a test file — excluded
    w(path.join(src, 'models', 'post.test.ts'), `import {Model} from '@getcronit/pylon-db'\n@model() class T extends Model {}`),
    // a declaration — excluded
    w(path.join(src, 'models', 'types.d.ts'), `import {Model} from '@getcronit/pylon-db'\nexport declare class X extends Model {}`),
    // generated output under a dot-dir — excluded
    w(path.join(src, '.pylon', 'gen.ts'), `import {Model} from '@getcronit/pylon-db'\n@model() class G extends Model {}`),
    // a dep under node_modules — excluded
    w(path.join(src, 'node_modules', 'dep.ts'), `import {Model} from '@getcronit/pylon-db'\n@model() class D extends Model {}`)
  ])
})

afterAll(async () => {
  await fs.rm(root, {recursive: true, force: true})
})

describe('discoverRegistrationModules', () => {
  it('finds model/queue modules and excludes entry, tests, .d.ts, dot-dirs, node_modules', async () => {
    const found = await discoverRegistrationModules(path.join(root, 'src'), entry)
    const rel = found.map(f => path.relative(path.join(root, 'src'), f).replace(/\\/g, '/'))
    expect(rel).toEqual(['models/post.ts', 'queues/publish.ts'])
  })

  it('does not match an unrelated class without a pylon import', async () => {
    const found = await discoverRegistrationModules(path.join(root, 'src'), entry)
    expect(found.some(f => f.endsWith('ring.ts'))).toBe(false)
  })

  it('emits relative side-effect imports from the entry directory', async () => {
    const found = await discoverRegistrationModules(path.join(root, 'src'), entry)
    const stmts = importStatements(found, path.dirname(entry))
    expect(stmts).toBe(`import "./models/post.ts"\nimport "./queues/publish.ts"\n`)
  })
})
