import {buildSchema, parse, print} from 'graphql'
import {describe, expect, it} from 'vitest'

import {InlineArgsTransform} from '@/core/gateway'

/**
 * `InlineArgsTransform` writes a delegate's arguments into the outgoing
 * DOCUMENT rather than declaring them as variables, because a delegate reshapes
 * a flat local signature into whatever the remote wants (`{input: {...}}`) and
 * a literal needs no type to be written. A file has no literal form, so those
 * — and only those — are lifted back out into the request payload where the
 * HTTP executor's multipart extraction can find them.
 */

const targetSchema = buildSchema(`
  scalar File
  input SubmitInput { note: String, attachments: [File!] }
  type Result { ok: Boolean! }
  type Mutation { submit(input: SubmitInput!): Result! }
  type Query { _: Boolean }
`)

/** Something a `File` check must accept without being one. */
const fakeFile = (name: string) => ({
  name,
  size: 3,
  arrayBuffer: async () => new ArrayBuffer(3),
  stream: () => ({})
})

const run = (args: Record<string, any>, variables: Record<string, any> = {}) => {
  const request = {
    document: parse('mutation { submit { ok } }'),
    variables
  }
  const out = new InlineArgsTransform(args).transformRequest(request, {
    targetSchema,
    fieldName: 'submit'
  })
  return {doc: print(out.document), variables: out.variables}
}

describe('InlineArgsTransform', () => {
  it('inlines ordinary arguments and sends no variables', () => {
    const {doc, variables} = run({input: {note: 'hello'}})

    expect(doc).toContain('submit(input: {note: "hello"})')
    expect(variables).toEqual({})
  })

  it('lifts a file out of the document and into the payload', () => {
    // Written as a literal it would become `{}` — a file has no enumerable
    // keys — and the upload would arrive at the remote as an empty object.
    const file = fakeFile('plan.png')
    const {doc, variables} = run({input: {note: 'hi', attachments: [file]}})

    expect(doc).toContain('attachments: [$_pylonUpload_0]')
    expect(doc).toContain('($_pylonUpload_0: File!)')
    expect(variables).toEqual({_pylonUpload_0: file})
  })

  it('declares each lifted file separately', () => {
    const [a, b] = [fakeFile('a.png'), fakeFile('b.pdf')]
    const {doc, variables} = run({input: {attachments: [a, b]}})

    expect(doc).toContain('attachments: [$_pylonUpload_0, $_pylonUpload_1]')
    expect(variables).toEqual({_pylonUpload_0: a, _pylonUpload_1: b})
  })

  it('does not prune or inline over a variable it introduced', () => {
    // The pruning and inlining passes both key on the INCOMING payload, where a
    // lifted file never appears. Left unguarded they delete the argument or
    // write `null` over it — which is how this reached a remote as `[null]`.
    const file = fakeFile('plan.png')
    const {doc, variables} = run({input: {attachments: [file]}}, {})

    expect(doc).not.toContain('null')
    expect(variables._pylonUpload_0).toBe(file)
  })
})
