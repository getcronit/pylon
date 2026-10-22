import {describe, it, expect} from 'vitest'
import {parse} from 'graphql'
import {buildParser, buildTestSchema} from './test-utils'

/** Every input-type NAME referenced by a field in the SDL must have a matching `input X { … }`
 *  definition. A dangling reference (named but never defined) makes `buildSchema` throw
 *  "Unknown type: X" and crashes the whole dev/build. */
function danglingInputRefs(sdl: string): string[] {
  const doc = parse(sdl)
  const defined = new Set<string>()
  const referenced = new Set<string>()
  for (const def of doc.definitions) {
    if (def.kind === 'InputObjectTypeDefinition') {
      defined.add(def.name.value)
      for (const f of def.fields ?? []) {
        let t: any = f.type
        while (t.kind === 'NonNullType' || t.kind === 'ListType') t = t.type
        if (t.kind === 'NamedType') referenced.add(t.name.value)
      }
    }
  }
  const builtins = new Set([
    'ID', 'String', 'Int', 'Float', 'Boolean', 'Number', 'JSON', 'JSONObject', 'Any',
    'Date', 'DateTime', 'Void', 'File', 'Upload',
  ])
  return [...referenced].filter(n => !defined.has(n) && !builtins.has(n))
}

describe('Pylon Builder - dangling input references', () => {
  // Reproduces the "Unknown type: MediaInput_1" crash: a model-like type used as an input carries
  // a Promise-returning relation getter (as pylon-db relations are). When its element shape
  // collides by field name with an existing, differently-shaped input (`media` → MediaInput), the
  // namer suffixes it (MediaInput_1) — but that suffixed input type is never emitted, leaving a
  // dangling reference that makes the generated schema invalid.
  it('emits a definition for every input type it references (Promise relation field)', () => {
    const code = `
      interface Asset { assetId: string }
      interface MediaFull { assetId: string; url: string; alt: string }

      // A record passed as an input that embeds a Promise-returning "relation" field named media,
      // whose unwrapped shape differs from the array Asset shape used elsewhere.
      interface Record {
        title: string
        media: Promise<MediaFull>
      }

      export const graphql = {
        Mutation: {
          // Establishes "MediaInput" from the { assetId } shape (field name: media).
          attach: (args: { input: { media: Asset[] } }) => ({ ok: true }),
          // media here unwraps the Promise to MediaFull — a DIFFERENT shape under the same field
          // name, so it must get its own emitted input type (not a dangling MediaInput_1).
          saveRecord: (args: { input: Record }) => ({ ok: true }),
        },
      }
    `
    const parser = buildParser(code)
    const sdl = parser.toString()

    expect(danglingInputRefs(sdl), `dangling input refs in SDL:\n${sdl}`).toEqual([])

    // buildTestSchema additionally builds the GraphQLSchema (via toSDL(toIR())) — which throws on a
    // dangling reference — so it is the end-to-end guard that the schema is constructible.
    expect(() => buildTestSchema(code)).not.toThrow()
  })
})
