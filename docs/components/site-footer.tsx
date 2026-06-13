import {Link} from '@getcronit/pylon-pages'
import {Logo} from './logo'

const LINKS: {title: string; items: {href: string; label: string; external?: boolean}[]}[] = [
  {
    title: 'Product',
    items: [
      {href: '/docs/why-pylon', label: 'Why Pylon'},
      {href: '/docs/getting-started', label: 'Getting started'},
      {href: '/docs/data/models', label: 'ORM'},
      {href: '/docs/frontend/use-pages', label: 'usePages'}
    ]
  },
  {
    title: 'Resources',
    items: [
      {href: '/docs/deployment/runtimes', label: 'Deployment'},
      {href: '/docs/reference/cli', label: 'CLI reference'},
      {href: 'https://github.com/getcronit/pylon', label: 'GitHub', external: true},
      {href: 'https://discord.gg/cbJjkVrnHe', label: 'Discord', external: true}
    ]
  }
]

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-bg-subtle">
      <div className="mx-auto grid max-w-[90rem] grid-cols-2 gap-8 px-6 py-12 md:grid-cols-4">
        <div className="col-span-2 md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-fg-muted">
            The type-driven fullstack framework. Write TypeScript — ship a GraphQL
            API, an ORM, queues, auth, and a React frontend.
          </p>
        </div>
        {LINKS.map(group => (
          <div key={group.title}>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              {group.title}
            </div>
            <ul className="flex flex-col gap-2 text-sm">
              {group.items.map(item =>
                item.external ? (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-fg-muted transition hover:text-fg">
                      {item.label}
                    </a>
                  </li>
                ) : (
                  <li key={item.label}>
                    <Link href={item.href} className="text-fg-muted transition hover:text-fg">
                      {item.label}
                    </Link>
                  </li>
                )
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-[90rem] border-t border-border px-6 py-6 text-sm text-fg-subtle">
        Built with Pylon + usePages · © {new Date().getFullYear()} Cronit
      </div>
    </footer>
  )
}
