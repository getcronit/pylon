import {Project} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {extractQueries} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'

/**
 * Repro for the SLOW cold-analyze on lokalis's Kontakte list page (~40s for one
 * file). The real DataGrid renders each row through a `Cell` that SWITCHES on
 * `column.type` and calls a DIFFERENT accessor per branch (title/initials/subtitle/
 * value/render), over a HETEROGENEOUS `columns` array — several of those accessors
 * call small shared helpers (`getName`, `getInitials` which itself calls `getName`).
 * The analyzer evaluates every branch's accessor for every column against the node,
 * and the PropertyAccess fallback cross-multiplies — the node param ends up carrying
 * thousands of paths (measured: a single `getName(c)` call produced raw=7655, and it
 * was evaluated ~9000×). Those paths are re-deduped at every recursion level
 * (`pathKeyStrict`), so time explodes even though the dedup keeps memory bounded.
 *
 * FIXED: the caller FILE is now analyzed exactly once, with every call expression
 * in it batched as targets, instead of a full `coreAnalyze` pass per call site.
 * That collapsed the same file from 15 re-analyses to 2 and this repro from
 * ~2700ms to ~190ms. The test asserts both correctness (field selection) and,
 * with ASSERT_TIME on, a hard time budget as a regression guard.
 */
describe('Performance Repro - grid switch/accessor path blowup', () => {
  const COLUMNS = 18
  const FILTERS = 12
  const OPTIONS = 12
  const VIEWS = 8
  const ASSERT_TIME = true
  const BUDGET_MS = 1500

  it('extracts correctly but is slow due to accessor × column × node multiplication', () => {
    const project = new Project({
      compilerOptions: {jsx: 4},
      useInMemoryFileSystem: true
    })

    // Heterogeneous columns: entity/text/badge, each branch a different accessor set.
    const columns = Array.from({length: COLUMNS}, (_, i) => {
      const kind = i % 3
      if (kind === 0)
        return `{ id: "c${i}", type: "entity", title: (c) => getName(c), initials: (c) => getInitials(c), subtitle: (c) => c.sub_${i}, href: (c) => "/x/" + c.id }`
      if (kind === 1)
        return `{ id: "c${i}", type: "text", value: (c) => c.field_${i} }`
      return `{ id: "c${i}", type: "badge", value: (c) => c.status_${i}, tone: (c) => c.tone_${i}, icon: (c) => c.icon_${i} }`
    }).join(',\n          ')

    const filterDefs = Array.from({length: FILTERS}, (_, i) => {
      const opts = Array.from(
        {length: OPTIONS},
        (_, j) => `{ label: "L${i}-${j}", value: "v_${i}_${j}" }`
      ).join(', ')
      return `{ id: "f${i}", label: "F${i}", type: "select", options: [${opts}] }`
    }).join(',\n          ')

    const views = Array.from(
      {length: VIEWS},
      (_, i) => `{ id: "v${i}", name: "V${i}", query: "q${i}" }`
    ).join(',\n          ')

    const code = `
      import { useData } from '@getcronit/pylon/pages';

      // Small shared helpers — trivial, but called from many column accessors AND from
      // rowActions; getInitials calls getName (nested helper chain).
      function getName(c) { return c.name || c.displayName || "?"; }
      function getInitials(c) { const n = getName(c); return n.slice(0, 2); }

      // The typed cell: one switch, a different accessor per column type.
      function Cell({ column, row }) {
        switch (column.type) {
          case "entity":
            return <a href={column.href(row)}><b>{column.initials(row)}</b>{column.title(row)}<i>{column.subtitle(row)}</i></a>;
          case "text":
            return <span>{column.value(row)}</span>;
          case "badge":
            return <span data-tone={column.tone(row)}>{column.icon(row)}{column.value(row)}</span>;
          default:
            return null;
        }
      }

      function GridRow(props) {
        const entityCol = props.columns.find((c) => c.type === "entity");
        const label = entityCol ? entityCol.title(props.row) : "";
        const actions = props.rowActions ? props.rowActions(props.row) : [];
        const trailing = actions.find((a) => a.variant === "destructive");
        return (
          <div aria-label={label}>
            {props.columns.map((col, j) => <Cell key={j} column={col} row={props.row} />)}
            {trailing && <button onClick={trailing.onClick}>{trailing.label}</button>}
          </div>
        );
      }

      function DataGrid(props) {
        return (
          <div>
            <div hidden>
              {props.filterDefs.map((f, i) => (
                <span key={i}>{f.label}: {f.options.map((o) => o.label).join()}</span>
              ))}
              {props.defaultViews.map((v, i) => <span key={i}>{v.name}</span>)}
            </div>
            {props.feed.nodes.map((n, i) => <GridRow key={i} {...props} row={n} />)}
          </div>
        );
      }

      export default function Page() {
        const feed = useData().contacts;
        const columns = [
          ${columns}
        ];
        const filterDefs = [
          ${filterDefs}
        ];
        const defaultViews = [
          ${views}
        ];
        const rowActions = (row) => [
          { id: "open", label: "Open", href: "/c/" + row.id },
          { id: "del", label: "Delete " + getName(row), variant: "destructive", onClick: () => {} },
        ];
        return (
          <DataGrid
            feed={feed}
            columns={columns}
            filterDefs={filterDefs}
            defaultViews={defaultViews}
            rowActions={rowActions}
          />
        );
      }
    `
    project.createSourceFile('/app.tsx', code)

    const t0 = Date.now()
    const {queries} = extractQueries('/app.tsx', project)
    const elapsed = Date.now() - t0
    // eslint-disable-next-line no-console
    console.log(
      `[perf] grid blowup: ${elapsed}ms (columns=${COLUMNS} filters=${FILTERS} options=${OPTIONS} views=${VIEWS})`
    )

    const json = JSON.stringify(queries[0]?.selectors ?? {})
    expect(json, 'name selected (via getName)').toContain('name')
    for (let i = 1; i < COLUMNS; i += 3) {
      expect(json, `field_${i} selected`).toContain(`field_${i}`)
    }

    if (ASSERT_TIME) {
      expect(elapsed, `extract should finish under ${BUDGET_MS}ms`).toBeLessThan(
        BUDGET_MS
      )
    }
  }, 180_000)
})
