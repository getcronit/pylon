/**
 * Larger end-to-end (no ORM): runs the shipped `pylon` CLI on a content-platform
 * app that exercises a broad slice of GraphQL features, then asserts on the
 * parsed `GraphQLSchema`. Also confirms the no-ORM path: the build runs without
 * any model contribution and still produces the right schema.
 *
 * Features covered: enums, nullability, lists, nested lists, self-reference,
 * interfaces (class inheritance), union-of-shared-objects → interface, input
 * objects, positional + object args, the Date scalar, async resolvers, and both
 * Query and Mutation roots.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {
  buildSchema,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema
} from 'graphql'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/blog-app')
const pylonDir = path.join(appDir, '.pylon')

let buildResult: ReturnType<typeof spawnSync>
let schema: GraphQLSchema
let config: Record<string, unknown> | undefined

beforeAll(async () => {
  if (!existsSync(cliBin)) {
    throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
  }
  await fs.rm(pylonDir, {recursive: true, force: true})
  buildResult = spawnSync('node', [cliBin, 'build'], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
  if (buildResult.status === 0) {
    schema = buildSchema(await fs.readFile(path.join(pylonDir, 'schema.graphql'), 'utf8'))
    config = (await import(pathToFileURL(path.join(pylonDir, 'pylon.config.js')).href)).config
  }
}, 180_000)

afterAll(async () => {
  await fs.rm(pylonDir, {recursive: true, force: true})
})

const obj = (name: string) => schema.getType(name) as GraphQLObjectType
const ft = (type: string, field: string) => String(obj(type).getFields()[field].type)
const implementsIface = (type: string, iface: string) =>
  obj(type).getInterfaces().some(i => i.name === iface)

describe('pylon build (shipped CLI) — content-platform app (no ORM)', () => {
  it('builds successfully into a valid schema', () => {
    expect(buildResult.status, String(buildResult.stderr ?? buildResult.stdout ?? "")).toBe(0)
    expect(schema).toBeInstanceOf(GraphQLSchema)
  })

  it('enums carry their values', () => {
    const role = schema.getType('Role') as GraphQLEnumType
    expect(role).toBeInstanceOf(GraphQLEnumType)
    expect(role.getValues().map(v => v.name)).toEqual(['ADMIN', 'AUTHOR', 'READER'])
    expect((schema.getType('PostStatus') as GraphQLEnumType).getValues().map(v => v.name)).toEqual([
      'DRAFT',
      'PUBLISHED',
      'ARCHIVED'
    ])
  })

  it('respects nullability (| null → nullable, otherwise non-null)', () => {
    expect(ft('Query', 'me')).toBe('User') // User | null
    expect(ft('Query', 'post')).toBe('Post') // Post | null
    expect(ft('User', 'email')).toBe('String') // string | null
    expect(ft('User', 'avatar')).toBe('Image') // Image | null
    expect(ft('Post', 'trailer')).toBe('Video') // Video | null
    expect(ft('User', 'name')).toBe('String!') // required
    expect(ft('Post', 'author')).toBe('User!')
  })

  it('lists, nested lists and self-reference', () => {
    expect(ft('Post', 'tags')).toBe('[String!]!')
    expect(ft('Post', 'comments')).toBe('[Comment!]!')
    expect(ft('Post', 'tagMatrix')).toBe('[[String!]!]!') // nested list
    expect(ft('Comment', 'replies')).toBe('[Comment!]!') // self-referential
  })

  it('class inheritance → interface implemented by subtypes', () => {
    expect(schema.getType('IMedia')).toBeInstanceOf(GraphQLInterfaceType)
    expect(implementsIface('Image', 'IMedia')).toBe(true)
    expect(implementsIface('Video', 'IMedia')).toBe(true)
    expect(ft('Post', 'media')).toBe('[IMedia!]!')
    expect(ft('Image', 'width')).toBe('Number!')
    expect(ft('Video', 'captions')).toBe('[String!]!')
  })

  it('a union of shared-field objects is promoted to an interface', () => {
    expect(schema.getType('SearchResult')).toBeInstanceOf(GraphQLInterfaceType)
    expect(implementsIface('Post', 'SearchResult')).toBe(true)
    expect(implementsIface('User', 'SearchResult')).toBe(true)
    expect(ft('Query', 'search')).toBe('[SearchResult!]!')
  })

  it('object args become input types (optional fields nullable)', () => {
    const input = schema.getType('CreatePostInput') as GraphQLInputObjectType
    expect(input).toBeInstanceOf(GraphQLInputObjectType)
    const f = input.getFields()
    expect(String(f.title.type)).toBe('String!')
    expect(String(f.tags.type)).toBe('[String!]!')
    expect(String(f.status.type)).toBe('PostStatus') // optional → nullable
    // filter input on a query
    expect(schema.getType('PostsFilterInput')).toBeInstanceOf(GraphQLInputObjectType)
  })

  it('resolver args: positional + object, scalars and lists', () => {
    const addComment = obj('Mutation').getFields().addComment
    const args = Object.fromEntries(addComment.args.map(a => [a.name, String(a.type)]))
    expect(args).toEqual({postId: 'String!', input: 'AddCommentInput!'})
    const publish = obj('Mutation').getFields().publishPosts
    expect(String(publish.args[0].type)).toBe('[String!]!')
  })

  it('Date scalar and async (Promise) resolvers', () => {
    expect(ft('Post', 'createdAt')).toBe('Date!')
    expect(ft('Query', 'feed')).toBe('[Post!]!') // Promise<Post[]> unwrapped
  })

  it('both roots resolve', () => {
    expect(schema.getQueryType()?.getFields().posts).toBeDefined()
    expect(ft('Query', 'posts')).toBe('[Post!]!')
    expect(ft('Mutation', 'createPost')).toBe('Post!')
  })

  it('loads config from the standalone pylon.config.ts', () => {
    // The CLI built .pylon/pylon.config.js from pylon.config.ts (not an inline export).
    expect(config).toMatchObject({graphiql: false, landingPage: false})
  })
})
