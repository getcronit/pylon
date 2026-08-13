import {Project} from 'ts-morph'
import {beforeEach, describe, expect, it} from 'vitest'
import {extractQueries} from './analyze'

describe('Nested useData queries', () => {
  let project: Project

  beforeEach(() => {
    project = new Project({
      compilerOptions: {jsx: 4},
      useInMemoryFileSystem: true
    })
  })

  it('should track contactId from useData and use it as an argument in a sub-component', () => {
    const filePath = '/args.tsx'
    const code = `
      import { useData } from '@getcronit/pylon-pages';

      function AddressList({ contactId }) {
        const data = useData();
        const addresses = data.addresses({ filters: { contactId } });
        return (
          <ul>
            {addresses.map(a => <li key={a.id}>{a.street}</li>)}
          </ul>
        );
      }

      export default function Page() {
        const data = useData();
        const contactId = data.contact({ id: '123' }).id;
        
        return (
          <div>
            <AddressList contactId={contactId} />
          </div>
        );
      }
    `
    project.createSourceFile(filePath, code)

    const {queries} = extractQueries(filePath, project)

    expect(queries.length).toBe(2)

    const addressQuery = queries[0]
    const pageQuery = queries[1]

    expect(pageQuery).toBeDefined()
    expect(addressQuery).toBeDefined()

    const pageSelectors = pageQuery!.selectors
    const addressSelectors = addressQuery!.selectors

    expect(pageSelectors).toMatchObject({
      contact: {
        __args: "{ id: '123' }",
        id: true
      }
    })

    expect(addressSelectors).toMatchObject({
      addresses: {
        __args: '{ filters: { contactId } }',
        __isList: true,
        id: true,
        street: true
      }
    })
  })
})
