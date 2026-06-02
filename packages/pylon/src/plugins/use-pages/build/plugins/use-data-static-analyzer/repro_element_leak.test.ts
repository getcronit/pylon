import {Project} from 'ts-morph'
import {beforeEach, describe, expect, it} from 'vitest'
import {extractQueries} from './analyze'

describe('extractQueries: Internal Key Leaks', () => {
  let project: Project

  beforeEach(() => {
    project = new Project({
      compilerOptions: {jsx: 4},
      useInMemoryFileSystem: true
    })
  })

  it('should leak __element into selectors when data is passed through a helper function', () => {
    const filePath = '/app.tsx'
    const code = `
      import { useData } from '@getcronit/pylon/pages';

      // This function returns a path containing __element
      function formatItems(items) {
        return items.map(item => ({
          label: item.name
        }));
      }

      export default function Page() {
        const data = useData();
        const formatted = formatItems(data.projects);
        
        return (
          <ul>
            {formatted.map(f => <li key={f.label}>{f.label}</li>)}
          </ul>
        );
      }
    `
    project.createSourceFile(filePath, code)

    const {queries} = extractQueries(filePath, project)

    // Check the first (and only) useData call
    const selectors = queries[0].selectors
    const jsonString = JSON.stringify(selectors)

    // REPRODUCTION POINT:
    // Because extractQueries uses deepMerge() to combine function return paths
    // into the main result object, and deepMerge does not have the
    // "if (key === '__element') continue" guard, the virtual key leaks.
    expect(
      jsonString,
      'Selectors should not contain internal __element keys'
    ).not.toContain('__element')

    expect(selectors).toEqual({
      projects: {
        __isList: true,
        name: true
      }
    })
  })

  it('should not leak __element when using array index access in a component', () => {
    const filePath = '/index.tsx'
    const code = `
      import { useData } from '@getcronit/pylon/pages';

      export function List() {
        const data = useData();
        const first = data.projects[0];
        return <div>{first.name}</div>;
      }
    `
    project.createSourceFile(filePath, code)

    const {queries} = extractQueries(filePath, project)
    const selectors = queries[0].selectors

    expect(JSON.stringify(selectors)).not.toContain('__element')

    expect(selectors).toEqual({
      projects: {
        __isList: true,
        name: true
      }
    })
  })

  it('should not leak __prop_ or __element when spreading function returns', () => {
    const filePath = '/spread.tsx'
    const code = `
      import { useData } from '@getcronit/pylon/pages';
      
      const getMeta = (obj) => ({ ...obj.meta });

      export function Component() {
        const data = useData();
        const meta = getMeta(data.user);
        return <div>{meta.role}</div>;
      }
    `
    project.createSourceFile(filePath, code)

    const {queries} = extractQueries(filePath, project)
    const selectors = queries[0].selectors

    expect(JSON.stringify(selectors)).not.toContain('__prop_')
    expect(JSON.stringify(selectors)).not.toContain('__element')

    expect(selectors).toEqual({
      user: {
        meta: {
          role: true
        }
      }
    })
  })

  it('should not leak __element when using array.reduce in hook returns', () => {
    const filePath = '/reduce.tsx'
    const code = `
      import { useData } from '@getcronit/pylon/pages';
      
      function buildNames(items) {
        return items.reduce((acc, item) => {
          acc[item.id] = item.name;
          return acc;
        }, {});
      }

      export function Component() {
        const data = useData();
        const names = buildNames(data.posts);
        return <div>{names[1]}</div>;
      }
    `
    project.createSourceFile(filePath, code)

    const {queries} = extractQueries(filePath, project)
    const selectors = queries[0].selectors

    expect(JSON.stringify(selectors)).not.toContain('__element')
    expect(JSON.stringify(selectors)).not.toContain('__prop_')

    expect(selectors).toEqual({
      posts: {
        __isList: true,
        id: true,
        name: true
      }
    })
  })
})
