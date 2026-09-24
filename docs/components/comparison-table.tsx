import {Check, Minus, X} from 'lucide-react'

type Cell = 'yes' | 'partial' | 'no'

const COLUMNS = ['Pylon', 'tRPC', 'Pothos / Nexus', 'Hasura / PostGraphile', 'RedwoodJS']

const ROWS: {label: string; cells: Cell[]}[] = [
  {label: 'Write plain TypeScript (no schema DSL)', cells: ['yes', 'yes', 'no', 'partial', 'no']},
  {label: 'Real, introspectable GraphQL API', cells: ['yes', 'no', 'yes', 'yes', 'yes']},
  {label: 'Non-TypeScript / public clients', cells: ['yes', 'no', 'yes', 'yes', 'yes']},
  {label: 'Built-in ORM + migrations', cells: ['yes', 'no', 'no', 'partial', 'yes']},
  {label: 'Row-level policies & multi-tenancy', cells: ['yes', 'no', 'no', 'partial', 'no']},
  {label: 'Job queues built in', cells: ['yes', 'no', 'no', 'no', 'partial']},
  {label: 'Frontend with build-time data fetching', cells: ['yes', 'no', 'no', 'no', 'partial']},
  {label: 'Edge runtimes (Workers/Deno/Bun)', cells: ['yes', 'partial', 'partial', 'no', 'no']}
]

function Mark({value}: {value: Cell}) {
  if (value === 'yes')
    return <Check size={17} className="mx-auto text-accent" aria-label="Yes" />
  if (value === 'partial')
    return <Minus size={17} className="mx-auto text-fg-subtle" aria-label="Partial" />
  return <X size={15} className="mx-auto text-fg-subtle/50" aria-label="No" />
}

export function ComparisonTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-subtle">
            <th className="px-4 py-3.5 text-left font-medium text-fg-muted">Capability</th>
            {COLUMNS.map((c, i) => (
              <th
                key={c}
                className={
                  'px-4 py-3.5 text-center font-semibold ' +
                  (i === 0 ? 'text-accent' : 'text-fg-muted')
                }>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, r) => (
            <tr
              key={row.label}
              className={r % 2 ? 'bg-bg-subtle/40' : ''}>
              <td className="px-4 py-3 text-left text-fg">{row.label}</td>
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  className={
                    'px-4 py-3 ' + (i === 0 ? 'bg-accent/[0.04]' : '')
                  }>
                  <Mark value={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
