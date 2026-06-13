import {Project} from 'ts-morph'
import {beforeEach, describe, expect, it} from 'vitest'
import {extractQueries} from './analyze'

describe('extractQueries: Multi-Column Analysis', () => {
  let project: Project

  beforeEach(() => {
    project = new Project({
      compilerOptions: {jsx: 4, allowJs: true},
      useInMemoryFileSystem: true
    })
  })

  it('should analyze all cell functions in a column definition array, not just the first', () => {
    const filePath = '/components/DataGrid.tsx'
    const code = `
      import { useData } from '@getcronit/pylon-pages/pages';
      import React, { useMemo } from 'react';

      export function ContactGrid() {
        const data = useData();
        
        const columns = useMemo(() => [
          {
            id: "name",
            accessorKey: "name",
            cell: (contact) => <div>{contact.firstName} {contact.lastName}</div>
          },
          {
            id: "company",
            accessorKey: "company",
            cell: (contact) => <div>{contact.company.name}</div>
          },
          {
            id: "email",
            accessorKey: "email",
            cell: (contact) => <a>{contact.emailAddress}</a>
          },
          {
           id: "address",
           accessorKey: "address",
          }
        ], []);

        return (
          <table>
            <tbody>
              {data.contacts.map(row => {
                return (
                  <tr>
                    {columns.map(col => {
                      const cellContent = col.cell
                        ? col.cell(row, {})
                        : String((row as any)[col.accessorKey] ?? "");

                      return <td>{cellContent}</td>
                    })}
                </tr>
              )})}
            </tbody>
          </table>
        );
      }
    `
    project.createSourceFile(filePath, code)

    const {queries} = extractQueries(filePath, project)
    const selectors = queries[0].selectors

    // To pass, the analyzer must have visited ALL THREE cell callbacks.
    // This means it needs to handle the fact that 'col.cell' is a union of paths.

    expect(selectors).toMatchObject({
      contacts: {
        __isList: true,
        firstName: true,
        lastName: true,
        company: {
          name: true
        },
        emailAddress: true,
        address: true
      }
    })
  })
})
