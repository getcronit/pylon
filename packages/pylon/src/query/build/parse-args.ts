/**
 * Parse the analyzer's normalized field-argument string into name → expression
 * pairs.
 *
 * The analyzer emits gqty-style single-object args, e.g.
 *   "{ first: 10, after: cursor }"     → { first: "10", after: "cursor" }
 *   "{ id }"                            → { id: "id" }            (shorthand)
 *   "{ where: { name: x }, first: 5 }"  → { where: "{ name: x }", first: "5" }
 *
 * We split on TOP-LEVEL commas/colons only (depth-aware over (){}[]`'" and
 * template strings), so ternaries and nested objects in values are preserved
 * verbatim. Anything that isn't a single object literal (a bare identifier,
 * spread, etc.) returns `null` → the caller fails loud.
 */
export interface ParsedArgs {
  [argName: string]: string
}

export function parseArgs(raw: string | undefined): ParsedArgs | null {
  if (raw == null) return null
  let s = raw.trim()
  if (s === '' || s === '{}') return {}

  // Strip a single matching outer brace pair, if present.
  if (s.startsWith('{')) {
    const end = matchingClose(s, 0)
    if (end !== s.length - 1) return null // not a single object literal
    s = s.slice(1, -1).trim()
  } else {
    // No outer braces. Could be `key: value, ...` (rare) — accept it; otherwise
    // a bare expression we can't map to named args → fail loud.
    if (!hasTopLevelColon(s)) return null
  }
  if (s === '') return {}

  const out: ParsedArgs = {}
  for (const segment of splitTopLevel(s, ',')) {
    const seg = segment.trim()
    if (seg === '') continue
    if (seg.startsWith('...')) return null // spread args: can't statically map
    const colon = topLevelColonIndex(seg)
    if (colon === -1) {
      // shorthand: { id } → id: id
      if (!/^[A-Za-z_$][\w$]*$/.test(seg)) return null
      out[seg] = seg
    } else {
      let key = seg.slice(0, colon).trim()
      const value = seg.slice(colon + 1).trim()
      if (key.startsWith('"') || key.startsWith("'")) key = key.slice(1, -1)
      if (key.startsWith('[')) return null // computed key — bail
      if (key === '' || value === '') return null
      out[key] = value
    }
  }
  return out
}

const OPEN: Record<string, string> = {'(': ')', '[': ']', '{': '}'}

/** Index of the matching close bracket for the open bracket at `start`. */
function matchingClose(s: string, start: number): number {
  const stack: string[] = []
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    const str = skipString(s, i)
    if (str !== i) {
      i = str - 1
      continue
    }
    if (OPEN[c]) stack.push(OPEN[c])
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}

/** If a string/template literal starts at `i`, return index just past it; else `i`. */
function skipString(s: string, i: number): number {
  const q = s[i]
  if (q !== '"' && q !== "'" && q !== '`') return i
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') {
      j++
      continue
    }
    if (s[j] === q) return j + 1
  }
  return s.length
}

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < s.length; i++) {
    const str = skipString(s, i)
    if (str !== i) {
      i = str - 1
      continue
    }
    const c = s[i]
    if (OPEN[c]) depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === sep && depth === 0) {
      parts.push(s.slice(last, i))
      last = i + 1
    }
  }
  parts.push(s.slice(last))
  return parts
}

function topLevelColonIndex(s: string): number {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const str = skipString(s, i)
    if (str !== i) {
      i = str - 1
      continue
    }
    const c = s[i]
    if (OPEN[c]) depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ':' && depth === 0) {
      // Skip `::` (not valid JS but be safe) — first top-level colon wins.
      return i
    }
  }
  return -1
}

function hasTopLevelColon(s: string): boolean {
  return topLevelColonIndex(s) !== -1
}
