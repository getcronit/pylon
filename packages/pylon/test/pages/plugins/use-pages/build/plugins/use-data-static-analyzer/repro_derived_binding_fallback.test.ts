import {Project} from 'ts-morph'
import {beforeEach, describe, expect, it} from 'vitest'
import {extractQueries} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'

/**
 * A binding derived from another binding must keep what it added.
 *
 * `const b = a ?? ''` is not `a`. The analyzer hoists every field argument into
 * the `useData()` variables thunk by resolving each binding back through its
 * initializer, and when the initializer is just another local it emits THAT
 * local — dropping the `??` and whatever it supplied.
 *
 * The result compiles, renders, and is wrong. That is what makes this worth a
 * test of its own: the sibling repros in this directory
 * (`repro_helper_local_in_args`, `repro_helper_prop_walk`) all end in a build
 * error or a render crash, and something that throws gets found. This one just
 * sends a different value.
 *
 * FROM A REAL STOREFRONT. `brands(productQuery:)` distinguishes an OMITTED
 * argument — every brand, for a manufacturer index — from an EMPTY one —
 * scoped, to whatever is currently visible. `undefined` reaches the wire as
 * omitted, so the page needs a definite string and wrote the obvious thing:
 *
 *     const vocabularyScope = collection ? scopeFor(collection) : undefined
 *     const brandScope = vocabularyScope ?? ''
 *     data.brands({productQuery: brandScope, first: 200})
 *
 * The thunk came out as `v3: vocabularyScope`, so on the unfiltered listing the
 * argument was `undefined`, the scope silently stopped applying, and the filter
 * offered all 192 manufacturers instead of the 166 with anything in stock. No
 * error anywhere — a longer list of real brands looks exactly like a page that
 * has not been narrowed yet.
 *
 * Both cases below are the same bug through the two helper shapes the two
 * storefronts happen to use, because a fix that unwraps one and not the other
 * would leave half of it standing.
 *
 * NOT COVERED HERE, and worth knowing about: the same source line in one of
 * those apps produced `vocabularyScope.handle` instead — a property read lifted
 * out of the imported helper, which throws at render rather than misreporting.
 * That was read off the built chunk and is real, but it has not been reduced to
 * a case this harness reproduces; every attempt here emitted the bare-identifier
 * form above. `repro_helper_local_in_args` covers the shape it resembles.
 */
describe('extractQueries: a derived binding keeps its own fallback', () => {
  let project: Project

  beforeEach(() => {
    project = new Project({
      compilerOptions: {jsx: 4},
      useInMemoryFileSystem: true
    })
  })

  /** The emitted argument expression for `brands`, as the thunk would read it. */
  const brandArgs = (entry: string): string =>
    String(
      (extractQueries(entry, project).queries[0]!.selectors as Record<string, any>).brands
        .__args ?? ''
    )

  it('keeps the fallback when the source binding is a helper CALL', () => {
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
        const walk = (node) => { out.push(node.handle); node.children.forEach(walk); };
        walk(root);
        return out;
      }
      export function collectionFilter(handles) {
        return 'collectionIn:' + handles.join(',');
      }
    `
    )

    const filePath = '/listing.tsx'
    project.createSourceFile(
      filePath,
      `
      import { useData } from '@getcronit/pylon/pages';
      import { subtreeHandles, collectionFilter } from './catalog';

      export default function Page({collections, collection}) {
        const vocabularyScope = collection
          ? collectionFilter(subtreeHandles(collections, collection))
          : undefined;
        const brandScope = vocabularyScope ?? '';
        const data = useData();
        const b = data.brands({productQuery: brandScope, first: 200});
        return <div>{b.nodes.map(x => x.id)}</div>;
      }
    `
    )

    const args = brandArgs(filePath)

    // REPRODUCTION POINT: emitted as `{ productQuery: vocabularyScope, ... }`.
    // `brandScope` is gone and with it the `?? ''`, so the argument is undefined
    // exactly when the fallback existed to prevent that.
    expect(
      args,
      'the argument must not collapse to the binding it was derived from'
    ).not.toMatch(/productQuery:\s*vocabularyScope\s*[,}]/)

    // Either spelling is correct — the binding itself, or its initializer in
    // full. What may not happen is losing the `??`.
    expect(
      /\bbrandScope\b/.test(args) || args.includes('??'),
      `the fallback has to survive; got ${args}`
    ).toBe(true)
  })

  it('keeps the fallback when the source binding is a helper called with an OBJECT', () => {
    // The second storefront reaches the same place through a builder that takes
    // a filter object, so the walk into the helper is a different one.
    project.createSourceFile(
      '/query.ts',
      `
      export function subtreeHandles(nodes, handle) {
        const out = [];
        const walk = (node) => { out.push(node.handle); node.children.forEach(walk); };
        nodes.forEach(walk);
        return out;
      }
      export function buildProductQuery(filters) {
        const parts = [];
        if (filters.collections) parts.push('collectionIn:' + filters.collections.join(','));
        if (filters.q) parts.push(filters.q);
        return parts.length ? parts.join(' ') : undefined;
      }
    `
    )

    const filePath = '/browser.tsx'
    project.createSourceFile(
      filePath,
      `
      import { useData } from '@getcronit/pylon/pages';
      import { subtreeHandles, buildProductQuery } from './query';

      export default function Page({collections, activeCollection}) {
        const vocabularyScope = buildProductQuery({
          collections: activeCollection
            ? subtreeHandles(collections, activeCollection.handle)
            : undefined
        });
        const brandScope = vocabularyScope ?? '';
        const data = useData();
        const b = data.brands({productQuery: brandScope, first: 200});
        return <div>{b.nodes.map(x => x.id)}</div>;
      }
    `
    )

    const args = brandArgs(filePath)

    expect(
      args,
      'the argument must not collapse to the binding it was derived from'
    ).not.toMatch(/productQuery:\s*vocabularyScope\s*[,}]/)

    expect(
      /\bbrandScope\b/.test(args) || args.includes('??'),
      `the fallback has to survive; got ${args}`
    ).toBe(true)
  })

  it('still resolves a plain alias, which has nothing of its own to lose', () => {
    // The other side of the rule, so a fix cannot simply stop resolving
    // bindings: `const b = a` really is `a`, and collapsing it is right.
    const filePath = '/alias.tsx'
    project.createSourceFile(
      filePath,
      `
      import { useData } from '@getcronit/pylon/pages';

      export default function Page({scope}) {
        const alias = scope;
        const data = useData();
        const b = data.brands({productQuery: alias, first: 200});
        return <div>{b.nodes.map(x => x.id)}</div>;
      }
    `
    )

    const args = brandArgs(filePath)
    expect(args).toMatch(/productQuery:\s*(alias|scope)\s*[,}]/)
  })
})
