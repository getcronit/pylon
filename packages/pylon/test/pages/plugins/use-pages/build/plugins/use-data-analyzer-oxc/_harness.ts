/**
 * Test harness for the oxc analyzer. Everything runs schema-directed against the
 * fixed `schema` fixture, so selections are validated (non-fields dropped, list-ness
 * exact). Sources are analyzed in-memory (no disk writes) via the module-graph
 * overlay.
 */
import {analyze} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/propagate'
import {schema} from './_schema'

const ROOT = '/app'

/** Order-independent canonical form (arg-branch arrays are unordered). */
export function canon(o: any): any {
  if (o === true) return true
  if (Array.isArray(o)) {
    return o.map(canon).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
  }
  if (o && typeof o === 'object') {
    const out: any = {}
    for (const k of Object.keys(o).sort()) out[k] = canon(o[k])
    return out
  }
  return o
}

/** Analyze a set of in-memory files; return every seed's selection, in order. */
export function analyzeFiles(
  files: Record<string, string>,
  entry: string
): any[] {
  const list = Object.entries(files).map(([path, text]) => ({
    path: path.startsWith('/') ? path : `${ROOT}/${path}`,
    text
  }))
  const entryPath = entry.startsWith('/') ? entry : `${ROOT}/${entry}`
  const res = analyze(list, {schema})
  // Stable order: by seed source position within the entry file first.
  return [...res.seedSelectors.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, sel]) => sel)
}

/** Analyze a single component source; return its first seed's selection. */
export function analyzeSource(source: string): any {
  return analyzeFiles({'Page.tsx': source}, 'Page.tsx')[0] ?? {}
}

/**
 * Convenience for the common case: a snippet that uses `data` (a `useData()`
 * result). Wrapped into a page component; returns the seed selection.
 */
export function select(body: string, resultName = 'data'): any {
  const source =
    `import { useData } from '@getcronit/pylon/pages'\n` +
    `export default function Page(props: any) {\n` +
    `  const ${resultName} = useData()\n` +
    `  ${body}\n` +
    `  return null as any\n}\n`
  return analyzeSource(source)
}
