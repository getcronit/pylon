import {useEffect, useRef, useState} from 'react'
import {Link} from '@getcronit/pylon-pages'
import {
  AppWindow,
  Boxes,
  Braces,
  ChevronDown,
  Database,
  KeyRound,
  Network,
  Rocket,
  Server,
  Sparkles,
  Workflow,
  Wand2,
  type LucideIcon
} from 'lucide-react'

export interface MenuItem {
  title: string
  desc: string
  href: string
  icon: LucideIcon
}
export interface MenuColumn {
  heading: string
  items: MenuItem[]
}

export const COLUMNS: MenuColumn[] = [
  {
    heading: 'Get started',
    items: [
      {title: 'Introduction', desc: 'What Pylon is', href: '/docs/introduction', icon: Sparkles},
      {title: 'Why Pylon', desc: 'One source of truth', href: '/docs/why-pylon', icon: Sparkles},
      {title: 'How It Works', desc: 'The compiler model', href: '/docs/how-pylon-works', icon: Braces},
      {title: 'Getting Started', desc: 'Your first API', href: '/docs/getting-started', icon: Rocket}
    ]
  },
  {
    heading: 'Core Concepts',
    items: [
      {title: 'Type-Driven Schema', desc: 'Types become the API', href: '/docs/core-concepts/type-driven-schema', icon: Braces},
      {title: 'Resolvers', desc: 'Queries & mutations', href: '/docs/core-concepts/resolvers', icon: Server},
      {title: 'The Pylon App', desc: 'Compose & serve', href: '/docs/core-concepts/the-pylon-app', icon: Boxes},
      {title: 'Gateway', desc: 'Stitch remote APIs', href: '/docs/core-concepts/gateway', icon: Network}
    ]
  },
  {
    heading: 'Data & Access',
    items: [
      {title: 'ORM Overview', desc: 'Models as classes', href: '/docs/data/overview', icon: Database},
      {title: 'Querying', desc: 'Filter & paginate', href: '/docs/data/queries', icon: Database},
      {title: 'Authentication', desc: 'Identity & roles', href: '/docs/authentication/overview', icon: KeyRound},
      {title: 'Policies', desc: 'Row-level access', href: '/docs/data/policies', icon: KeyRound}
    ]
  },
  {
    heading: 'Frontend & Ship',
    items: [
      {title: 'usePages', desc: 'Server-rendered React', href: '/docs/frontend/overview', icon: AppWindow},
      {title: 'useData', desc: 'Auto-generated queries', href: '/docs/frontend/use-data', icon: Wand2},
      {title: 'Background Jobs', desc: 'Queues & cron', href: '/docs/queues/overview', icon: Workflow},
      {title: 'Deployment', desc: 'Node, Bun, Workers', href: '/docs/production/deployment', icon: Rocket}
    ]
  }
]

export function MegaNav() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on Escape (keyboard) or a click outside the menu (touch / click users).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ' +
          (open ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:bg-bg-elevated hover:text-fg')
        }>
        Documentation
        <ChevronDown
          size={14}
          className={'transition-transform ' + (open ? 'rotate-180' : '')}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 pt-3">
          <div className="w-[58rem] max-w-[calc(100vw-3rem)] rounded-xl border border-border bg-bg-elevated/95 p-5 shadow-2xl backdrop-blur-md">
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
              {COLUMNS.map(col => (
                <div key={col.heading}>
                  <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                    {col.heading}
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {col.items.map(item => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-bg-subtle">
                          <item.icon
                            size={15}
                            className="mt-0.5 shrink-0 text-fg-subtle transition group-hover:text-accent"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-fg group-hover:text-fg">
                              {item.title}
                            </span>
                            <span className="block truncate text-xs text-fg-subtle">
                              {item.desc}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-4 border-t border-border/70 pt-3 text-sm">
              <Link
                href="/docs/getting-started"
                onClick={() => setOpen(false)}
                className="font-medium text-accent transition hover:text-accent-strong">
                Start the quickstart →
              </Link>
              <span className="text-border-strong">·</span>
              <Link
                href="/docs/guides/build-an-app"
                onClick={() => setOpen(false)}
                className="text-fg-muted transition hover:text-fg">
                Build an app
              </Link>
              <Link
                href="/docs/reference/cli"
                onClick={() => setOpen(false)}
                className="text-fg-muted transition hover:text-fg">
                CLI reference
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
