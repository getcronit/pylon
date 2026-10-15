export interface TocHeading {
  depth: number
  id: string
  text: string
}

export function Toc({headings}: {headings: TocHeading[]}) {
  if (headings.length === 0) return null
  return (
    <nav className="text-sm" data-toc>
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        On this page
      </div>
      <ul className="flex flex-col gap-1 border-l border-border">
        {headings.map(h => (
          <li key={h.id} style={{paddingLeft: 12 + (h.depth - 2) * 12}}>
            <a
              href={'#' + h.id}
              className="toc-link -ml-px block border-l border-transparent py-0.5 text-fg-muted transition hover:text-fg">
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
