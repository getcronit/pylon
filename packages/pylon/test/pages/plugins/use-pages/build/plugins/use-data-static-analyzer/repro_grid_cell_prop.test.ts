import {Project} from 'ts-morph'
import {beforeEach, describe, expect, it} from 'vitest'
import {extractQueries} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'

describe('repro: grid columns-prop with cell callbacks (data-grid-virtual shape)', () => {
  let project: Project

  beforeEach(() => {
    project = new Project({
      compilerOptions: {jsx: 4},
      useInMemoryFileSystem: true
    })
  })

  it('selects node fields read inside cell callbacks passed via a columns prop', () => {
    const filePath = '/app.tsx'
    const code = `
      import { useData } from '@getcronit/pylon/pages';

      function Grid({ feed, columns }) {
        return (
          <div>
            <div hidden>
              {feed.nodes.length > 0 &&
                columns.map((col, i) => <span key={i}>{col.cell(feed.nodes[0])}</span>)}
            </div>
            {feed.nodes.map((n, i) => (
              <div key={i}>{columns.map((col, j) => <span key={j}>{col.cell(n)}</span>)}</div>
            ))}
          </div>
        );
      }

      export default function Page() {
        const feed = useData().inventoryItems;
        const columns = [
          { id: "sku", cell: (item) => item.sku },
          { id: "avail", cell: (item) => {
              const level = item.levels.find(l => l.locationId === "x");
              return level.available;
          } },
          { id: "tracked", cell: (item) => item.tracked },
        ];
        return <Grid feed={feed} columns={columns} />;
      }
    `
    project.createSourceFile(filePath, code)
    const {queries} = extractQueries(filePath, project)
    const json = JSON.stringify(queries[0]?.selectors ?? {})
    expect(json, 'sku selected').toContain('sku')
    expect(json, 'tracked selected').toContain('tracked')
    expect(json, 'levels selected').toContain('levels')
    expect(json, 'available (element subfield) selected').toContain('available')
  })
})
