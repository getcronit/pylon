import {fileURLToPath} from 'url'
import * as path from 'path'
import {describe, expect, it} from 'vitest'
import {extractAdvancedSelectors} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'
import {canon, traceSchemaless} from './_harness'
import {mineAdvancedCorpus} from './_corpus'

const here = path.dirname(fileURLToPath(import.meta.url))
const OLD = path.resolve(here, '../use-data-static-analyzer')

const cases = [
  ...mineAdvancedCorpus(path.join(OLD, 'analyze.test.ts')),
  ...mineAdvancedCorpus(path.join(OLD, 'bracket-access.test.ts'))
]

/**
 * Cases where the oxc tracer intentionally diverges from the ts-morph oracle
 * (documented, not regressions). Keyed by test title. These are exactly the
 * list-vs-object judgements the ts-morph analyzer makes with the TypeChecker and
 * oxc defers to schema validation — schemaless, oxc can't reproduce them, but the
 * schema-directed path does (covered by lists.test.ts / arg-branches.test.ts).
 */
const KNOWN_DIVERGENCES = new Set<string>([
  // JS intrinsics (length/forEach/reverse/map/startsWith) recorded as fields
  // schemaless; the schema post-pass drops them (not schema fields).
  'should still treat invoked builtins as JS, not fields',
  'should handle complex array transformations inside useMemo',
  'should handle selecting from a memoized array that was built via push',
  'should not mark properties as lists when calling string methods like startsWith (Issue 2)',
  'should handle nested function calls and closures inside .map',
  'should work when i pass a node into a constructed array',
  // list-vs-object marking that needs types: ts-morph uses the TypeChecker, oxc
  // uses schema validation (sets __isList from the field's [...] wrapping).
  'should handle list status update after initial merge',
  'should handle array find/some/every methods with destructuring',
  'should not mark an object as a list when it is wrapped in an array literal'
])

describe('corpus parity · oxc tracer vs ts-morph extractAdvancedSelectors', () => {
  cases.forEach((c, i) => {
    const run = KNOWN_DIVERGENCES.has(c.title) ? it.fails : it
    run(`[${i}] ${c.title}`, () => {
      const oracle = extractAdvancedSelectors(c.input, c.name)
      const oxc = traceSchemaless(c.input, c.name)
      expect(canon(oxc)).toEqual(canon(oracle))
    })
  })
})
