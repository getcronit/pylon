import {Link} from '@getcronit/pylon-pages/pages'
import {
  AppWindow,
  Boxes,
  Braces,
  Database,
  GraduationCap,
  Rocket,
  Sparkles,
  Terminal,
  type LucideIcon
} from 'lucide-react'

export interface NavItem {
  slug: string
  title: string
}
export interface NavSection {
  title: string
  items: NavItem[]
}

const SECTION_ICONS: Record<string, LucideIcon> = {
  Introduction: Sparkles,
  'Core Concepts': Braces,
  'Data — pylon-db': Database,
  Apps: Boxes,
  'Frontend — usePages': AppWindow,
  Production: Rocket,
  Guides: GraduationCap,
  Reference: Terminal
}

export function Sidebar({nav, currentPath}: {nav: NavSection[]; currentPath: string}) {
  return (
    <nav className="flex flex-col gap-7 text-sm">
      {nav.map(section => {
        const Icon = SECTION_ICONS[section.title]
        return (
          <div key={section.title}>
            <div className="mb-2 flex items-center gap-1.5 px-2.5 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              {Icon && <Icon size={13} className="text-fg-subtle/80" />}
              {section.title}
            </div>
            <ul className="flex flex-col gap-0.5">
              {section.items.map(item => {
                const active = item.slug === currentPath
                return (
                  <li key={item.slug}>
                    <Link
                      href={item.slug}
                      className={
                        'block rounded-md border-l-2 px-2.5 py-1.5 transition ' +
                        (active
                          ? 'border-accent bg-bg-elevated font-medium text-accent'
                          : 'border-transparent text-fg-muted hover:border-border-strong hover:text-fg')
                      }>
                      {item.title}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
