import {Project} from 'ts-morph'
import {beforeEach, describe, expect, it} from 'vitest'
import {extractQueries} from './analyze'

const HOOK = `
  import { useData } from '@getcronit/pylon-pages';
  export function useContactFromEmail({ email }: any) {
    const data = useData();
    const hint = data.contactAddressHint({ email });
    const ownerC = hint?.owner;
    const owner = ownerC ? { id: ownerC.id, name: ownerC.name, displayName: ownerC.displayName } : null;
    const orgC = hint?.organization;
    const organization = orgC ? { id: orgC.id, name: orgC.name, displayName: orgC.displayName } : null;
    const domain = hint?.domain ?? '';
    return { owner, organization, domain };
  }
`

describe('custom hook return consumed by a page', () => {
  let project: Project
  beforeEach(() => {
    project = new Project({compilerOptions: {jsx: 4}, useInMemoryFileSystem: true})
  })

  it('page destructures owner from the hook and reads owner.displayName', () => {
    project.createSourceFile('/hook.ts', HOOK)
    project.createSourceFile(
      '/page.tsx',
      `
        import { useContactFromEmail } from './hook';
        function initials(c: any) { return c.name || c.displayName; }
        export default function Page() {
          const { owner, organization, domain } = useContactFromEmail({ email: 'a@b.c' });
          if (owner) { return <div>{initials(owner)}{owner.displayName}{owner.id}</div>; }
          if (organization) { return <div>{organization.displayName}{organization.id}</div>; }
          return <div>{domain}</div>;
        }
      `
    )
    const pageRes = extractQueries('/page.tsx', project)
    const hookRes = extractQueries('/hook.ts', project)
    // eslint-disable-next-line no-console
    console.log('\nPAGE selectors =', JSON.stringify(pageRes.queries.map(q => q.selectors), null, 2))
    // eslint-disable-next-line no-console
    console.log('HOOK selectors =', JSON.stringify(hookRes.queries.map(q => q.selectors), null, 2))
    // The hook's own useData query must keep owner nested under contactAddressHint.
    for (const q of hookRes.queries) {
      expect(Object.keys(q.selectors)).toEqual(['contactAddressHint'])
    }
  })
})
