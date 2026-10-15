import {Project} from 'ts-morph'
import {beforeEach, describe, expect, it} from 'vitest'
import {extractQueries} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'

describe('repro: list .find(...).subfield selection', () => {
  let project: Project

  beforeEach(() => {
    project = new Project({
      compilerOptions: {jsx: 4},
      useInMemoryFileSystem: true
    })
  })

  it('selects the list AND the element subfield used after .find()', () => {
    const filePath = '/app.tsx'
    const code = `
      import { useData } from '@getcronit/pylon/pages';
      export default function Page() {
        const data = useData();
        return (
          <ul>
            {data.items.nodes.map(item => {
              const level = item.levels.find(l => l.locationId === "x");
              return <li key={item.id}>{level.available}{item.tracked}</li>;
            })}
          </ul>
        );
      }
    `
    project.createSourceFile(filePath, code)
    const {queries} = extractQueries(filePath, project)
    const json = JSON.stringify(queries[0].selectors)
    // The pattern in products/inventory: item.levels.find(l => ...).available
    expect(json, 'levels must be selected').toContain('levels')
    expect(json, 'element subfield available must be selected').toContain(
      'available'
    )
    expect(json, 'sibling field tracked must be selected').toContain('tracked')
  })
})
