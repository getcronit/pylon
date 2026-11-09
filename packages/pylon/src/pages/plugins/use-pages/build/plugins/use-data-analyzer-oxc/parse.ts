import * as crypto from 'crypto'
import {parseSync, type EcmaScriptModule} from 'oxc-parser'

export interface ParsedFile {
  path: string
  hash: string
  /** oxc ESTree Program (typed loosely — @oxc-project/types is ESTree + JSX). */
  program: any
  /** oxc module import/export linkage table. */
  module: EcmaScriptModule
  /** Raw source text (kept for arg stringification + span slicing). */
  text: string
}

const cache = new Map<string, ParsedFile>()

function hash(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex')
}

/** Parse a TS/TSX file with oxc, memoized by content hash. */
export function parseFile(path: string, text: string): ParsedFile {
  const h = hash(text)
  const hit = cache.get(path)
  if (hit && hit.hash === h) return hit

  const lang = path.endsWith('.tsx') || path.endsWith('.jsx') ? undefined : undefined
  const res = parseSync(path, text, {
    astType: 'ts',
    range: false,
    // JSX is enabled by the .tsx/.jsx extension; .ts still parses TS.
    lang: path.endsWith('.tsx')
      ? 'tsx'
      : path.endsWith('.jsx')
        ? 'jsx'
        : path.endsWith('.ts')
          ? 'ts'
          : 'tsx'
  })

  const parsed: ParsedFile = {
    path,
    hash: h,
    program: res.program,
    module: res.module,
    text
  }
  cache.set(path, parsed)
  return parsed
}

/** Drop a file from the parse cache (dev incremental invalidation). */
export function invalidateParse(path: string): void {
  cache.delete(path)
}

export function clearParseCache(): void {
  cache.clear()
}
