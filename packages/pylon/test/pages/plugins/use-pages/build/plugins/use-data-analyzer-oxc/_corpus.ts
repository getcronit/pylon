/**
 * Mines `(title, input, name)` triples out of the old ts-morph analyzer's test
 * files — every `const result = extractAdvancedSelectors(input, name)` call — so
 * the same inputs can be replayed through the oxc analyzer for a parity diff. Uses
 * oxc to parse the test files.
 */
import * as fs from 'fs'
import {parseSync} from 'oxc-parser'

export interface CorpusCase {
  title: string
  input: string
  name: string
}

function walk(node: any, visit: (n: any) => void) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) return node.forEach(n => walk(n, visit))
  if (typeof node.type === 'string') visit(node)
  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end') continue
    walk(node[k], visit)
  }
}

export function mineAdvancedCorpus(file: string): CorpusCase[] {
  const src = fs.readFileSync(file, 'utf8')
  const {program} = parseSync(file, src, {astType: 'ts'})

  const its: {title: string; start: number; end: number}[] = []
  const templates: {name: string; start: number; value: string}[] = []
  const calls: {start: number; input: any; name: string}[] = []

  walk(program, n => {
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'Identifier' &&
      (n.callee.name === 'it' || n.callee.name === 'test') &&
      n.arguments[0]?.type === 'Literal'
    ) {
      its.push({title: String(n.arguments[0].value), start: n.start, end: n.end})
    }
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
      if (n.init.type === 'TemplateLiteral') {
        templates.push({name: n.id.name, start: n.start, value: src.slice(n.init.start + 1, n.init.end - 1)})
      } else if (n.init.type === 'Literal' && typeof n.init.value === 'string') {
        templates.push({name: n.id.name, start: n.start, value: n.init.value})
      }
    }
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'Identifier' &&
      n.callee.name === 'extractAdvancedSelectors'
    ) {
      calls.push({
        start: n.start,
        input: n.arguments[0],
        name: n.arguments[1]?.type === 'Literal' ? String(n.arguments[1].value) : 'data'
      })
    }
  })

  const resolveInput = (a0: any, before: number): string | null => {
    if (!a0) return null
    if (a0.type === 'TemplateLiteral') return src.slice(a0.start + 1, a0.end - 1)
    if (a0.type === 'Literal' && typeof a0.value === 'string') return a0.value
    if (a0.type === 'Identifier') {
      const c = templates.filter(t => t.name === a0.name && t.start < before)
      if (c.length) return c.sort((x, y) => y.start - x.start)[0].value
    }
    return null
  }
  const titleOf = (pos: number) => its.find(i => i.start <= pos && i.end >= pos)?.title ?? `case@${pos}`

  const out: CorpusCase[] = []
  for (const c of calls) {
    const input = resolveInput(c.input, c.start)
    if (input != null) out.push({title: titleOf(c.start), input, name: c.name})
  }
  return out
}
