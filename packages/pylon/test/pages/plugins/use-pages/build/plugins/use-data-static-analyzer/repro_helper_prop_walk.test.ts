import {Project} from 'ts-morph'
import {beforeEach, describe, expect, it} from 'vitest'
import {extractQueries} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'

describe('extractQueries: helpers called with non-data arguments', () => {
  let project: Project

  beforeEach(() => {
    project = new Project({
      compilerOptions: {jsx: 4},
      useInMemoryFileSystem: true
    })
  })

  it('does not attribute a helper walk over a PROP to the data node', () => {
    const filePath = '/app.tsx'
    // `scopeOf` never touches `data`. It walks a plain tree that arrived as a
    // prop — the shape a catalogue rail uses to render its collections. Its
    // property reads (`handle`, `children`) are not a GraphQL selection, and
    // there is no field on the connection for them to be one of.
    const code = `
      import { useData } from '@getcronit/pylon/pages';

      function scopeOf(nodes, handle) {
        const path = [];
        const walk = (list) => list.some(node => {
          path.push(node);
          if (node.handle === handle || walk(node.children)) return true;
          path.pop();
          return false;
        });
        walk(nodes);
        const current = path[path.length - 1];
        return {trail: path.slice(0, -1), children: current.children};
      }

      export default function Page({collections, activeHandle}) {
        const data = useData();
        const list = data.products({first: 10});
        const scope = scopeOf(collections, activeHandle);
        return (
          <div>
            {list.nodes.map(p => <span key={p.title}>{p.title}</span>)}
            {scope.children.map(c => <b key={c.name}>{c.name}</b>)}
          </div>
        );
      }
    `
    project.createSourceFile(filePath, code)

    const {queries} = extractQueries(filePath, project)
    const selectors = queries[0]!.selectors as Record<string, any>

    // REPRODUCTION POINT: the helper's own property reads are merged onto the
    // node of the data field that happens to share the component, so the
    // compiled document asks `products { handle children name }` — and the
    // build fails with `Field "handle" does not exist on type
    // "ProductConnection"` before anything renders.
    expect(
      Object.keys(selectors.products),
      'a helper over a prop must not add fields to the data node'
    ).not.toContain('handle')

    expect(selectors).toEqual({
      products: {
        __args: '{ first: 10 }',
        nodes: {
          __isList: true,
          title: true
        }
      }
    })
  })

  it('does not attribute an IMPORTED helper walk to the data node', () => {
    // The shape that actually broke a build: the helper lives in another module
    // and its parameter happens to be named like the caller's data binding.
    project.createSourceFile(
      '/catalog.ts',
      `
      export function collectionScope(nodes, handle) {
        const path = [];
        const walk = (list) => list.some(node => {
          path.push(node);
          if (node.handle === handle || walk(node.children)) return true;
          path.pop();
          return false;
        });
        walk(nodes);
        return {children: path.length ? path[path.length - 1].children : []};
      }
    `
    )
    const filePath = '/page.tsx'
    project.createSourceFile(
      filePath,
      `
      import { useData } from '@getcronit/pylon/pages';
      import { collectionScope } from './catalog';

      export default function Page({collections, activeHandle}) {
        const data = useData();
        const list = data.products({first: 10});
        const scope = collectionScope(collections, activeHandle);
        return <div>{list.nodes.map(p => p.title)}{scope.children.length}</div>;
      }
    `
    )

    const {queries} = extractQueries(filePath, project)
    const selectors = queries[0]!.selectors as Record<string, any>

    expect(Object.keys(selectors.products)).not.toContain('handle')
    expect(Object.keys(selectors.products)).not.toContain('children')
  })

  it('still lets a NESTED function read the component\'s data', () => {
    // The other side of the rule: a closure is written inside the component and
    // reading its data is the whole point, so it must keep the caller's scope.
    const filePath = '/nested.tsx'
    project.createSourceFile(
      filePath,
      `
      import { useData } from '@getcronit/pylon/pages';

      export default function Page() {
        const data = useData();
        const list = data.products({first: 10});
        function titles() {
          return list.nodes.map(p => p.title);
        }
        return <div>{titles()}</div>;
      }
    `
    )

    const {queries} = extractQueries(filePath, project)
    const selectors = queries[0]!.selectors as Record<string, any>

    expect(selectors.products.nodes).toEqual({__isList: true, title: true})
  })
})
