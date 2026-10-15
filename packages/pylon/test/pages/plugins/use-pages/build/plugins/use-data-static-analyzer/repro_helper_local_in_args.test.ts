import {Project} from 'ts-morph'
import {beforeEach, describe, expect, it} from 'vitest'
import {extractQueries} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'

describe('extractQueries: a helper local must not become a query argument', () => {
  let project: Project

  beforeEach(() => {
    project = new Project({
      compilerOptions: {jsx: 4},
      useInMemoryFileSystem: true
    })
  })

  it('stringifies the caller\'s binding, not the helper\'s internal one', () => {
    // `subtreeHandles` walks a plain tree and happens to name a local `root`.
    // Nothing about that local exists at the call site.
    project.createSourceFile(
      '/catalog.ts',
      `
      export function subtreeHandles(nodes, handle) {
        const find = (list) => {
          for (const node of list) {
            if (node.handle === handle) return node;
            const hit = find(node.children);
            if (hit) return hit;
          }
          return null;
        };

        const root = find(nodes);
        if (!root) return [handle];

        const out = [];
        const seen = new Set();
        const walk = (node) => {
          if (seen.has(node.handle)) return;
          seen.add(node.handle);
          out.push(node.handle);
          node.children.forEach(walk);
        };
        walk(root);
        return out;
      }
      export function collectionFilter(handles) {
        const tokens = handles.map(h => 'collections.handle:' + h);
        return tokens.length === 1 ? tokens[0] : '(' + tokens.join(' OR ') + ')';
      }
    `
    )

    const filePath = '/page.tsx'
    project.createSourceFile(
      filePath,
      `
      import { useData } from '@getcronit/pylon/pages';
      import { subtreeHandles, collectionFilter } from './catalog';

      export default function Page({collections, collection}) {
        const scope = collection
          ? collectionFilter(subtreeHandles(collections, collection))
          : undefined;
        const data = useData();
        const list = data.products({query: scope, first: 10});
        return <div>{list.nodes.map(p => p.title)}</div>;
      }
    `
    )

    const {queries} = extractQueries(filePath, project)
    const args = String(
      (queries[0]!.selectors as Record<string, any>).products.__args ?? ''
    )

    // REPRODUCTION POINT: the analyzer hoists every field argument into the
    // `useData()` variables thunk. It resolved `scope` through the helper it was
    // built by and emitted that helper's OWN local — so the thunk read `root`,
    // a name that exists nowhere in the page, and the route 500s with
    // `ReferenceError: root is not defined` at render.
    expect(args, 'the argument must not name a helper local').not.toMatch(/\broot\b/)
    expect(args, "the argument is the caller's own binding").toContain('scope')
  })


  it('does not append a helper\'s property reads to the caller\'s variable', () => {
    // The second half of the same failure. `subtreeHandles` reads `node.handle`
    // off the plain tree it was handed; that segment is not a property of the
    // caller's variable, and appending it emitted `scope.handle` — which builds,
    // then reads `handle` off a string at render.
    project.createSourceFile(
      '/tree.ts',
      `
      export function subtreeHandles(nodes, handle) {
        const out = [];
        const walk = (node) => {
          out.push(node.handle);
          node.children.forEach(walk);
        };
        nodes.forEach(walk);
        return out;
      }
    `
    )

    const filePath = '/list.tsx'
    project.createSourceFile(
      filePath,
      `
      import { useData } from '@getcronit/pylon/pages';
      import { subtreeHandles } from './tree';

      export default function Page({collections, collection}) {
        const scope = collection ? subtreeHandles(collections, collection).join(' ') : undefined;
        const data = useData();
        const list = data.products({query: scope, first: 10});
        return <div>{list.nodes.map(p => p.title)}</div>;
      }
    `
    )

    const {queries} = extractQueries(filePath, project)
    const args = String(
      (queries[0]!.selectors as Record<string, any>).products.__args ?? ''
    )

    expect(args, 'no property of the tree may be appended').not.toMatch(/scope\./)
    expect(args).toContain('scope')
  })
})
