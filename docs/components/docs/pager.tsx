import {Link} from '@getcronit/pylon-pages'
import {ArrowLeft, ArrowRight} from 'lucide-react'

export interface PagerLink {
  slug: string
  title: string
}

export function Pager({prev, next}: {prev: PagerLink | null; next: PagerLink | null}) {
  return (
    <div className="mt-16 grid grid-cols-2 gap-4 border-t border-border pt-8">
      <div>
        {prev && (
          <Link
            href={prev.slug}
            className="group flex flex-col rounded-lg border border-border p-4 transition hover:border-accent/50 hover:bg-bg-subtle">
            <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <ArrowLeft size={13} /> Previous
            </span>
            <span className="mt-1 font-medium text-fg group-hover:text-accent">
              {prev.title}
            </span>
          </Link>
        )}
      </div>
      <div>
        {next && (
          <Link
            href={next.slug}
            className="group flex flex-col items-end rounded-lg border border-border p-4 text-right transition hover:border-accent/50 hover:bg-bg-subtle">
            <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
              Next <ArrowRight size={13} />
            </span>
            <span className="mt-1 font-medium text-fg group-hover:text-accent">
              {next.title}
            </span>
          </Link>
        )}
      </div>
    </div>
  )
}
