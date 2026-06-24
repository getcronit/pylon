import {useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import {Link} from '@getcronit/pylon-pages'
import {Github, Menu, X} from 'lucide-react'
import {COLUMNS} from './mega-nav'

const FLAT_LINKS = [
  {href: '/docs/guides/build-an-app', label: 'Guides'},
  {href: '/docs/reference/cli', label: 'Reference'}
]

/** Hamburger + slide-over menu for narrow screens (the desktop nav is hidden < md). */
export function MobileNav() {
  const [open, setOpen] = useState(false)

  // Lock body scroll while the drawer is open, and close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    if (open) document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="rounded-md p-2 text-fg-muted transition hover:bg-bg-elevated hover:text-fg">
        <Menu size={20} />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          // Portal to <body>: the header's `backdrop-blur` is a containing block for
          // fixed-positioned descendants, which would otherwise clip this overlay.
          <div className="fixed inset-0 z-[60]">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* panel */}
          <div className="absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col border-l border-border bg-bg-elevated shadow-2xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/70 px-4">
              <span className="text-sm font-semibold text-fg">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-fg-muted transition hover:bg-bg-subtle hover:text-fg">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-5">
              {COLUMNS.map(col => (
                <div key={col.heading} className="mb-6">
                  <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                    {col.heading}
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {col.items.map(item => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="group flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-bg-subtle">
                          <item.icon
                            size={16}
                            className="shrink-0 text-fg-subtle transition group-hover:text-accent"
                          />
                          <span className="text-sm font-medium text-fg">{item.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <div className="mb-2 flex flex-col gap-0.5 border-t border-border/70 pt-4">
                {FLAT_LINKS.map(l => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-2 py-2 text-sm font-medium text-fg-muted transition hover:bg-bg-subtle hover:text-fg">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 border-t border-border/70 px-4 py-4">
              <Link
                href="/docs/getting-started"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-md bg-accent px-4 py-2 text-center text-sm font-semibold text-accent-foreground transition hover:bg-accent-strong">
                Get started
              </Link>
              <a
                href="https://github.com/getcronit/pylon"
                target="_blank"
                rel="noreferrer"
                aria-label="Pylon on GitHub"
                className="rounded-md border border-border-strong p-2 text-fg-muted transition hover:bg-bg-subtle hover:text-fg">
                <Github size={18} />
              </a>
            </div>
          </div>
          </div>,
          document.body
        )}
    </div>
  )
}
