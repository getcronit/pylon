import {Link, type PageProps} from '@getcronit/pylon-pages/pages'
import {
  ArrowRight,
  Boxes,
  Braces,
  Compass,
  Database,
  Layers,
  Rocket,
  Sparkles
} from 'lucide-react'
import {ArchitectureDiagram} from '@/components/architecture-diagram'

const START = [
  {href: '/docs/why-pylon', icon: Compass, title: 'Why Pylon', body: 'Where it fits, and how it compares.'},
  {href: '/docs/how-pylon-works', icon: Braces, title: 'How it works', body: 'The compiler that derives it all.'},
  {href: '/docs/getting-started', icon: Rocket, title: 'Quickstart', body: 'A running API in under a minute.'},
  {href: '/docs/guides/build-an-app', icon: Sparkles, title: 'Build an app', body: 'Model, API, and a page, end to end.'}
]

const BOX = [
  {href: '/docs/core-concepts/type-driven-schema', icon: Braces, title: 'The GraphQL API', body: 'Write functions and classes; get an introspectable schema with no SDL.'},
  {href: '/docs/data/overview', icon: Database, title: 'Data — pylon-db', body: 'A full ORM: models, relations, migrations, policies, and multi-tenancy.'},
  {href: '/docs/frontend/overview', icon: Layers, title: 'Frontend — usePages', body: 'A server-rendered React frontend with build-time data fetching.'},
  {href: '/docs/queues/overview', icon: Boxes, title: 'Production', body: 'Background queues, OIDC auth, modular apps, and any-runtime deploys.'}
]

const Page: React.FC<PageProps> = () => {
  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      {/* Intro */}
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-subtle px-3 py-1 text-xs font-medium text-fg-muted">
          <Sparkles size={13} className="text-accent" /> Documentation
        </span>
        <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
          The whole backend, <span className="text-gradient">from your types</span>
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-fg-muted">
          Pylon is one framework where your TypeScript defines a production system.
          You write plain functions and classes; a compiler derives a GraphQL API,
          a database, background jobs, auth, and a React frontend — and proves they
          stay consistent. Because it's derived, it can't drift; because it's one
          model, the compiler can check it. One codebase, one type system, one
          deploy.
        </p>
      </div>

      {/* The big picture */}
      <section className="mt-14">
        <div className="mb-6 text-center text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          Anatomy of a Pylon app
        </div>
        <ArchitectureDiagram />
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-fg-subtle">
          That one verifiable model is also what makes Pylon a foundation you — and
          an AI agent — can build on without it drifting apart. It's where the
          framework is headed.
        </p>
      </section>

      {/* Start here */}
      <section className="mt-16">
        <h2 className="text-lg font-semibold text-white">Start here</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {START.map(c => (
            <Link
              key={c.href}
              href={c.href}
              className="group rounded-xl border border-border bg-bg-subtle/40 p-4 transition hover:border-accent/40 hover:bg-bg-subtle">
              <c.icon size={18} className="text-accent" />
              <div className="mt-3 flex items-center gap-1 font-medium text-white">
                {c.title}
                <ArrowRight
                  size={14}
                  className="opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100"
                />
              </div>
              <p className="mt-1 text-sm text-fg-muted">{c.body}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* What's in the box */}
      <section className="mt-14">
        <h2 className="text-lg font-semibold text-white">What's in the box</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {BOX.map(c => (
            <Link
              key={c.href}
              href={c.href}
              className="group flex gap-4 rounded-xl border border-border bg-bg-subtle/40 p-5 transition hover:border-accent/40 hover:bg-bg-subtle">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-accent">
                <c.icon size={18} />
              </div>
              <div>
                <div className="flex items-center gap-1 font-semibold text-white">
                  {c.title}
                  <ArrowRight
                    size={14}
                    className="opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100"
                  />
                </div>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{c.body}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Progressive story */}
      <section className="mt-14 rounded-2xl border border-border bg-bg-subtle/30 p-8">
        <h2 className="text-lg font-semibold text-white">Grows with you</h2>
        <p className="mt-2 max-w-2xl text-sm text-fg-muted">
          Nothing is all-or-nothing. Start with a single function and add each
          capability when you need it — every piece is the same type system.
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {[
            {step: '01', title: 'A function', body: 'Export one resolver and you have a typed GraphQL API with a playground.'},
            {step: '02', title: 'A database', body: 'Add a model; the same class becomes a table, with migrations generated for you.'},
            {step: '03', title: 'A full stack', body: 'Add usePages, queues, auth, and tenancy — all in one app, one deploy.'}
          ].map(s => (
            <div key={s.step}>
              <div className="font-mono text-sm text-accent">{s.step}</div>
              <div className="mt-1 font-medium text-white">{s.title}</div>
              <p className="mt-1 text-sm text-fg-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <div className="mt-12 text-center">
        <Link
          href="/docs/getting-started"
          className="glow-accent inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition hover:bg-accent-strong">
          Get started <ArrowRight size={16} />
        </Link>
      </div>
    </main>
  )
}

export default Page
