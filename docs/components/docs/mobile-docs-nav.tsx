import {useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import {PanelLeft, X} from 'lucide-react'
import {Sidebar, type NavSection} from './sidebar'

/**
 * On narrow screens the docs sidebar is hidden, leaving no way to move between
 * pages. This renders a toggle that opens the full navigation tree in a drawer.
 */
export function MobileDocsNav({
  nav,
  currentPath
}: {
  nav: NavSection[]
  currentPath: string
}) {
  const [open, setOpen] = useState(false)

  // Close when navigation completes (currentPath changes) and on Escape.
  useEffect(() => setOpen(false), [currentPath])
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
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="mb-6 inline-flex items-center gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm font-medium text-fg-muted transition hover:border-border-strong hover:text-fg">
        <PanelLeft size={15} />
        Browse docs
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[88%] max-w-xs flex-col border-r border-border bg-bg-elevated shadow-2xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/70 px-4">
              <span className="text-sm font-semibold text-fg">Documentation</span>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-fg-muted transition hover:bg-bg-subtle hover:text-fg">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-5">
              <Sidebar nav={nav} currentPath={currentPath} />
            </div>
          </div>
          </div>,
          document.body
        )}
    </div>
  )
}
