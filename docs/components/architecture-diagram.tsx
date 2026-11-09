import {
  AppWindow,
  Braces,
  Database,
  Globe,
  KeyRound,
  Network,
  Server,
  Workflow
} from 'lucide-react'

/**
 * "Anatomy of a Pylon app" — the big picture: one TypeScript codebase,
 * projected by the compiler into an API, a database, and a frontend, backed by
 * first-party services, all running as a single app on any runtime.
 */
export function ArchitectureDiagram() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Input: your code */}
      <div className="mx-auto max-w-md rounded-xl border border-accent/30 bg-bg-elevated p-4 text-center glow-accent">
        <div className="flex items-center justify-center gap-2 text-sm font-semibold text-white">
          <Braces size={16} className="text-accent" />
          Your TypeScript
        </div>
        <div className="mt-1 font-mono text-xs text-fg-muted">
          resolvers · models · pages
        </div>
      </div>

      {/* Compiler spine */}
      <div className="flex flex-col items-center">
        <div className="h-5 w-px bg-gradient-to-b from-accent/60 to-border" />
        <div className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          type-introspection compiler
        </div>
        <div className="h-5 w-px bg-gradient-to-b from-border to-accent/40" />
      </div>

      {/* Fan-out line */}
      <div className="relative mx-auto mb-4 h-px w-[78%] bg-border">
        <span className="absolute left-1/6 top-1/2 h-2 w-px -translate-y-1/2 bg-border" />
        <span className="absolute left-1/2 top-1/2 h-2 w-px -translate-y-1/2 bg-border" />
        <span className="absolute right-1/6 top-1/2 h-2 w-px -translate-y-1/2 bg-border" />
      </div>

      {/* Derived: API / ORM / frontend */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Network,
            title: 'GraphQL API',
            body: 'A real, introspectable schema — any client, with a playground.',
            tag: 'schema + resolvers'
          },
          {
            icon: Database,
            title: 'pylon-db ORM',
            body: 'Models become tables. Policies and tenancy live at the data layer.',
            tag: 'SQL + migrations'
          },
          {
            icon: AppWindow,
            title: 'usePages',
            body: 'Server-rendered React; each page fetches exactly what it renders.',
            tag: 'typed client'
          }
        ].map(c => (
          <div
            key={c.title}
            className="rounded-xl border border-border bg-bg-subtle/50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <c.icon size={16} className="text-accent" />
              {c.title}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted">{c.body}</p>
            <div className="mt-3 inline-block rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
              {c.tag}
            </div>
          </div>
        ))}
      </div>

      {/* Backed by */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-xl border border-border bg-bg-subtle/30 px-4 py-3 text-xs text-fg-muted">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Backed by
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Server size={13} className="text-fg-subtle" /> PostgreSQL
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Workflow size={13} className="text-fg-subtle" /> Redis · Queues
        </span>
        <span className="inline-flex items-center gap-1.5">
          <KeyRound size={13} className="text-fg-subtle" /> OIDC · Auth
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Globe size={13} className="text-fg-subtle" /> Remote APIs · Gateway
        </span>
      </div>

      {/* Runtime band */}
      <div className="mt-4 rounded-xl border border-accent/20 bg-gradient-to-r from-accent/[0.06] to-violet/[0.06] px-4 py-3 text-center text-xs font-medium text-fg-muted">
        One app, one deploy — runs on{' '}
        <span className="text-fg">Node · Bun · Deno · Cloudflare Workers</span>
      </div>
    </div>
  )
}
