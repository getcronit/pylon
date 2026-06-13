import {Link} from '@getcronit/pylon-pages/pages'
import {Github} from 'lucide-react'
import {Logo} from './logo'

const NAV = [
  {href: '/docs', label: 'Docs'},
  {href: '/docs/why-pylon', label: 'Why Pylon'},
  {href: '/docs/data/overview', label: 'ORM'},
  {href: '/docs/frontend/overview', label: 'usePages'}
]

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-6 px-6">
        <Link href="/" className="transition hover:opacity-80">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-fg-muted transition hover:bg-bg-elevated hover:text-fg">
              {item.label}
              {item.badge && (
                <span className="rounded-full border border-violet/30 bg-violet/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet">
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a
            href="https://github.com/getcronit/pylon"
            target="_blank"
            rel="noreferrer"
            aria-label="Pylon on GitHub"
            className="rounded-md p-2 text-fg-muted transition hover:bg-bg-elevated hover:text-fg">
            <Github size={18} />
          </a>
          <Link
            href="/docs/getting-started"
            className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-foreground transition hover:bg-accent-strong">
            Get started
          </Link>
        </div>
      </div>
    </header>
  )
}
