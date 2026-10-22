import {Project} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {extractQueries} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'

describe('Performance Repro - Slow findReferences', () => {
  it('should successfully extract queries but take a long time due to findReferences on nested arrow functions', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        baseUrl: '/',
        paths: {
          '@/pages/*': ['./*']
        }
      },
      useInMemoryFileSystem: true
    })

    // Create 150 noise files to increase project size, which forces findReferences to search a large graph
    for (let i = 1; i <= 150; i++) {
      project.createSourceFile(
        `/components/Noise${i}.tsx`,
        `
        import React from 'react';
        export const NoiseComponent${i} = () => {
          return <div>Noise ${i}</div>;
        };
        `
      )
    }

    // Create 10 nested arrow function components to amplify the findReferences delay (10 * slow search)
    for (let i = 1; i <= 10; i++) {
      project.createSourceFile(
        `/components/Comp${i}.tsx`,
        `
        import React from 'react';
        export const Comp${i} = ({data}) => {
          return <div>{data.field_${i}}</div>;
        };
        `
      )
    }

    // Export them via an index file to match a real-world multi-export UI library setup
    const exports = Array.from({length: 10}, (_, i) => `export * from './Comp${i + 1}';`).join('\n')
    project.createSourceFile('/components/index.ts', exports)

    // Create the page importing all 10 arrow function components
    const imports = Array.from({length: 10}, (_, i) => `import { Comp${i + 1} } from '@/pages/components';`).join('\n')
    const renders = Array.from({length: 10}, (_, i) => `<Comp${i + 1} data={data} />`).join('\n')

    project.createSourceFile(
      '/Parent.tsx',
      `
      import React from 'react';
      import { useData } from '@getcronit/pylon/pages';
      ${imports}
      
      export default function Page() {
        const data = useData();
        return (
          <div>
            ${renders}
          </div>
        );
      }
      `
    )

    console.time('extractQueries with findReferences')
    const {queries} = extractQueries('/Parent.tsx', project)
    console.timeEnd('extractQueries with findReferences')

    // Verify correct extraction
    const expected: Record<string, any> = {}
    for (let i = 1; i <= 10; i++) {
      expected[`field_${i}`] = true
    }
    expect(queries[0].selectors).toEqual(expected)
  })
})
