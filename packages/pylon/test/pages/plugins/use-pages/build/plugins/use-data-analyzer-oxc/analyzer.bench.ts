/**
 * Worst-case comparison: oxc analyzer vs the ts-morph analyzer on the patterns
 * that stress a data-flow analyzer hardest. Run with `vitest bench`.
 *
 * ts-morph gets its FAIR best case: one shared project with a warm TypeChecker,
 * and only the analysis memo flushed per iteration (as in a running build). oxc
 * analyzes the page self-contained (it never loads files the page doesn't import).
 * Selectors only — lowering is shared and excluded.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {Project} from 'ts-morph'
import {bench, describe} from 'vitest'
import {
  clearAnalyzeCache,
  extractQueries
} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'
import {ModuleGraph} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/module-graph'
import {analyze} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/propagate'

const HOOK = `import { useData } from '@getcronit/pylon/pages'\n`
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pylon-worstcase-'))

/** Materialize a fixture on disk, return {dir, page, warm ts-morph project}. */
function scenario(name: string, files: Record<string, string>) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, {recursive: true})
  for (const [rel, src] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, src)
  }
  const page = path.join(dir, 'Page.tsx')
  const project = new Project({compilerOptions: {jsx: 4, allowJs: true}})
  project.addSourceFilesAtPaths(`${dir}/**/*.{ts,tsx}`)
  project.resolveSourceFileDependencies()
  extractQueries(page, project, {}) // warm the checker
  // Persistent graph, as a real build reuses across pages; warm it once.
  const graph = new ModuleGraph()
  analyze([{path: page, text: fs.readFileSync(page, 'utf8')}], {graph})
  return {dir, page, project, graph}
}

const runTs = (s: {page: string; project: Project}) => {
  clearAnalyzeCache()
  extractQueries(s.page, s.project, {})
}
const runOxc = (s: {page: string; graph: ModuleGraph}) => {
  analyze([{path: s.page, text: fs.readFileSync(s.page, 'utf8')}], {graph: s.graph})
}

// ── 1. Big project + barrel: forces ts-morph's whole-project findReferences ──────
{
  const NOISE = 500
  const COMPS = 16
  const files: Record<string, string> = {}
  for (let i = 0; i < NOISE; i++)
    files[`noise${i}.tsx`] = `import {useState} from 'react'
      export const N${i} = () => { const [x] = useState(0); const f = () => x + ${i}; return <div>{f()}</div> }`
  for (let i = 0; i < COMPS; i++)
    files[`components/C${i}.tsx`] = `export const C${i} = ({ data }: any) => <div>{data.user({ id: "1" }).field_${i}}</div>`
  files['components/index.ts'] = Array.from({length: COMPS}, (_, i) => `export * from './C${i}'`).join('\n')
  const imp = `import { ${Array.from({length: COMPS}, (_, i) => `C${i}`).join(', ')} } from './components'`
  const rend = Array.from({length: COMPS}, (_, i) => `<C${i} data={data} />`).join('')
  files['Page.tsx'] = HOOK + imp + `\nexport default function Page(){ const data = useData(); return <div>${rend}</div> }`

  const s = scenario('bigproject', files)
  describe(`big project + barrel (${NOISE + COMPS} files)`, () => {
    bench('ts-morph', () => runTs(s))
    bench('oxc', () => runOxc(s))
  })
}

// ── 2. Grid config-blowup: heterogeneous accessor closures + switch (lokalis) ────
{
  const COLUMNS = 120
  const cols = Array.from({length: COLUMNS}, (_, i) => {
    const k = i % 3
    if (k === 0) return `{ type:"entity", title:(c:any)=>getName(c), sub:(c:any)=>c.sub_${i} }`
    if (k === 1) return `{ type:"text", value:(c:any)=>c.field_${i} }`
    return `{ type:"badge", value:(c:any)=>c.status_${i}, tone:(c:any)=>c.tone_${i} }`
  }).join(',\n')
  const files = {
    'Page.tsx':
      HOOK +
      `function getName(c:any){ return c.name || c.displayName }
       function Cell({column,row}:any){ switch(column.type){
         case "entity": return <b>{column.title(row)}{column.sub(row)}</b>
         case "text": return <span>{column.value(row)}</span>
         default: return <i>{column.value(row)}{column.tone(row)}</i> } }
       function Grid(props:any){ return <div>{props.feed.map((n:any)=>props.columns.map((c:any)=><Cell column={c} row={n}/>))}</div> }
       export default function Page(){ const feed = useData().contacts; const columns = [${cols}]; return <Grid feed={feed} columns={columns}/> }`
  }
  const s = scenario('gridblowup', files)
  describe(`grid config-blowup (${COLUMNS} accessor columns)`, () => {
    bench('ts-morph', () => runTs(s))
    bench('oxc', () => runOxc(s))
  })
}

// ── 3. Deep prop-drill: data threaded through many component levels ──────────────
{
  const LEVELS = 40
  const files: Record<string, string> = {}
  for (let i = 0; i < LEVELS; i++) {
    const next = i === LEVELS - 1
      ? `<span>{data.users.map((u:any)=>u.name)}{data.me.email}</span>`
      : `<C${i + 1} data={data} />`
    const imp = next.startsWith('<C') ? `import { C${i + 1} } from './C${i + 1}'\n` : ''
    files[`C${i}.tsx`] = `${imp}export function C${i}({ data }: any) { return ${next} }`
  }
  files['Page.tsx'] = HOOK + `import { C0 } from './C0'\nexport default function Page(){ const data = useData(); return <C0 data={data} /> }`
  const s = scenario('deepdrill', files)
  describe(`deep prop-drill (${LEVELS} levels)`, () => {
    bench('ts-morph', () => runTs(s))
    bench('oxc', () => runOxc(s))
  })
}

// ── 4. Wide fan-out: one huge component, many reads + many helper calls ──────────
{
  const READS = 250
  const HELPERS = 40
  const helperDefs = Array.from({length: HELPERS}, (_, i) => `function h${i}(o:any){ return o.hf_${i} }`).join('\n')
  const reads = Array.from({length: READS}, (_, i) => `data.field_${i}`).join(' + ')
  const calls = Array.from({length: HELPERS}, (_, i) => `h${i}(data.user({ id: "1" }))`).join(' + ')
  const files = {
    'Page.tsx':
      HOOK +
      helperDefs +
      `\nexport default function Page(){ const data = useData(); const a = ${reads}; const b = ${calls}; return <div>{a}{b}</div> }`
  }
  const s = scenario('widefanout', files)
  describe(`wide fan-out (${READS} reads + ${HELPERS} helper calls)`, () => {
    bench('ts-morph', () => runTs(s))
    bench('oxc', () => runOxc(s))
  })
}
