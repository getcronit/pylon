import {Link, type PageProps} from '@getcronit/pylon-pages'
import {
  ArrowRight,
  Boxes,
  Database,
  KeyRound,
  Layers,
  ListChecks,
  Server,
  Wand2,
  Workflow,
  Zap
} from 'lucide-react'
import {CodePanel, Tok} from '@/components/code-panel'
import {ComparisonTable} from '@/components/comparison-table'
import {ArchitectureDiagram} from '@/components/architecture-diagram'

const RUNTIMES = ['Node.js', 'Bun', 'Deno', 'Cloudflare Workers']

const FEATURES = [
  {
    icon: Zap,
    title: 'Type-driven schema',
    body: 'Write functions and classes. Pylon introspects their TypeScript types and generates a complete GraphQL schema — no SDL, no decorators, no codegen to babysit.'
  },
  {
    icon: Database,
    title: 'Batteries-included ORM',
    body: 'Models, relations, migrations, validation, and lifecycle signals — a Prisma-class data layer that ships in the box and never drifts from your API.'
  },
  {
    icon: KeyRound,
    title: 'Policies & multi-tenancy',
    body: 'Row-level access policies and tenant scoping live at the data layer, so they apply to every query and relation — impossible to forget.'
  },
  {
    icon: Workflow,
    title: 'Job queues',
    body: 'Define typed queues, processors, and cron jobs with a transactional outbox for exactly-once delivery — background work without a second framework.'
  },
  {
    icon: Layers,
    title: 'usePages frontend',
    body: 'A file-based React frontend with build-time query analysis: every page fetches exactly the data it renders, server-rendered and hydrated.'
  },
  {
    icon: Boxes,
    title: 'Composable apps',
    body: 'Bundle models, migrations, and resolvers into modular apps with cross-app relations — Django-style structure for a TypeScript stack.'
  }
]

const Page: React.FC<PageProps> = () => {
  return (
    <main>
      {/* ---------- Hero ---------- */}
      <section className="mx-auto max-w-[90rem] px-6 pt-16 pb-12 lg:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <Link
              href="/docs/why-pylon"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-subtle px-3 py-1 text-xs font-medium text-fg-muted transition hover:border-accent/40 hover:text-fg">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              The type-driven fullstack framework
              <ArrowRight size={12} />
            </Link>

            <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
              <span className="text-gradient">Write TypeScript.</span>
              <br />
              Ship the whole stack.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-muted">
              Pylon turns plain TypeScript into a production GraphQL API, an ORM,
              queues, auth, and a React frontend — all derived from your types.
              Because it's derived, it can't drift, and a change is verified across
              every layer. One model, checked by the compiler.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/getting-started"
                className="glow-accent inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition hover:bg-accent-strong">
                Get started <ArrowRight size={16} />
              </Link>
              <code className="rounded-md border border-border bg-bg-subtle px-4 py-2.5 font-mono text-sm text-fg-muted">
                npm create pylon@latest
              </code>
            </div>
          </div>

          {/* Transform: TS in → GraphQL out */}
          <div className="relative">
            <CodePanel filename="src/index.ts" accent>
              <code>
                {Tok.k('import')} {'{Pylon}'} {Tok.k('from')}{' '}
                {Tok.s("'@getcronit/pylon'")}
                {'\n\n'}
                {Tok.k('class')} {Tok.t('User')} {'{\n'}
                {'  id'}
                {Tok.k('!')}: {Tok.t('string')}
                {'\n'}
                {'  name'}
                {Tok.k('!')}: {Tok.t('string')}
                {'\n'}
                {'  email'}
                {Tok.k('!')}: {Tok.t('string')} | {Tok.k('null')}
                {'\n'}
                {'}\n\n'}
                {Tok.k('export default')} {Tok.k('new')} {Tok.t('Pylon')}({'{\n'}
                {'  graphql: {\n'}
                {'    '}
                {Tok.f('Query')}: {'{\n'}
                {'      user: ('}id: {Tok.t('string')}): {Tok.t('User')} ={'>'} {'({\n'}
                {'        id, name: '}
                {Tok.s("'Ada'")}
                {', email: '}
                {Tok.k('null')}
                {'\n      })\n'}
                {'    }\n'}
                {'  }\n'}
                {'})'}
              </code>
            </CodePanel>

            <div className="my-3 flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
              <span className="h-px w-8 bg-border" />
              Pylon generates
              <ArrowRight size={13} className="text-accent" />
              <span className="h-px w-8 bg-border" />
            </div>

            <CodePanel filename="schema.graphql">
              <code>
                {Tok.k('type')} {Tok.t('User')} {'{\n'}
                {'  id: '}
                {Tok.t('String!')}
                {'\n'}
                {'  name: '}
                {Tok.t('String!')}
                {'\n'}
                {'  email: '}
                {Tok.t('String')}
                {'\n}\n\n'}
                {Tok.k('type')} {Tok.t('Query')} {'{\n'}
                {'  user(id: '}
                {Tok.t('String!')}
                {'): '}
                {Tok.t('User')}
                {'\n}'}
              </code>
            </CodePanel>
          </div>
        </div>

        {/* Runtimes */}
        <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-border pt-8 text-sm text-fg-subtle">
          <span className="text-xs font-semibold uppercase tracking-wider">
            Runs anywhere
          </span>
          {RUNTIMES.map(r => (
            <span key={r} className="font-medium text-fg-muted">
              {r}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- Big picture ---------- */}
      <section className="mx-auto max-w-[90rem] px-6 py-16">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            The whole system, from your types
          </h2>
          <p className="mt-4 text-lg text-fg-muted">
            One TypeScript codebase. A compiler derives the API, the database, and
            the frontend — and proves they stay consistent.
          </p>
        </div>
        <ArchitectureDiagram />
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-fg-subtle">
          One model a compiler can check is also the soundest foundation to build
          on — for your team, and for the AI agents working alongside it. That's
          the direction Pylon is built for.
        </p>
      </section>

      {/* ---------- Features ---------- */}
      <section className="mx-auto max-w-[90rem] px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            One framework, not six libraries
          </h2>
          <p className="mt-4 text-lg text-fg-muted">
            Everything you stitch together by hand — schema, data, auth, background
            jobs, frontend — comes from one type-driven toolchain.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="group rounded-xl border border-border bg-bg-subtle/40 p-6 transition hover:border-accent/40 hover:bg-bg-subtle">
              <div className="inline-flex rounded-lg border border-border bg-bg-elevated p-2.5 text-accent transition group-hover:border-accent/40">
                <f.icon size={20} />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Full-stack usePages showcase ---------- */}
      <section className="border-y border-border bg-bg-subtle/30 py-20">
        <div className="mx-auto max-w-[90rem] px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/5 px-3 py-1 text-xs font-medium text-violet">
              <Layers size={13} /> Frontend included · usePages
            </span>
            <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
              Your frontend, type-connected
            </h2>
            <p className="mt-4 text-lg text-fg-muted">
              usePages is a server-rendered React frontend that lives in your Pylon
              app. It reads your GraphQL schema with full type-safety — and
              generates the exact data query for every page at build time.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl items-start gap-6 lg:grid-cols-2">
            <CodePanel filename="src/index.ts">
              <code>
                {Tok.k('class')} {Tok.t('Post')} {'{\n'}
                {'  id'}
                {Tok.k('!')}: {Tok.t('string')}
                {'\n  title'}
                {Tok.k('!')}: {Tok.t('string')}
                {'\n}\n\n'}
                {Tok.k('export default')} {Tok.k('new')} {Tok.t('Pylon')}({'{\n'}
                {'  graphql: {\n'}
                {'    '}
                {Tok.f('Query')}: {'{\n'}
                {'      posts: (): '}
                {Tok.t('Post')}
                {'[] => '}
                {Tok.t('Post')}
                {'.objects.'}
                {Tok.f('all')}
                {'()\n'}
                {'    }\n  }\n})'}
              </code>
            </CodePanel>

            <CodePanel filename="pages/page.tsx" accent>
              <code>
                {Tok.k('function')} {Tok.f('Posts')}
                {'() {\n'}
                {'  '}
                {Tok.k('const')} data = {Tok.f('useData')}
                {'()\n\n'}
                {'  '}
                {Tok.k('return')} data.posts.{Tok.f('map')}
                {'(p => (\n'}
                {'    '}
                {Tok.t("<Link href={'/posts/' + p.id}>")}
                {'{p.title}'}
                {Tok.t('</Link>')}
                {'\n  ))\n}'}
              </code>
            </CodePanel>
          </div>

          <div className="mx-auto mt-6 flex max-w-3xl items-start gap-3 rounded-xl border border-accent/20 bg-accent/[0.04] p-4 text-sm text-fg-muted">
            <Wand2 size={18} className="mt-0.5 shrink-0 text-accent" />
            <p>
              Pylon sees the page reads <code>id</code> and <code>title</code>, and
              generates <code>{'{ posts { id title } }'}</code> — at build time. No
              query written by hand, and never more than the page renders.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-3">
            {[
              {icon: Boxes, title: 'One app, one deploy', body: 'API and frontend are the same project — no separate client, no CORS, no second deployment.'},
              {icon: Wand2, title: 'No queries to write', body: 'Read fields off a typed proxy; Pylon generates the minimal query for each page.'},
              {icon: Server, title: 'Server-rendered', body: 'Each request renders with its data resolved, then hydrates instantly on the client.'}
            ].map(item => (
              <div key={item.title} className="text-center">
                <div className="mx-auto inline-flex rounded-lg border border-border bg-bg-elevated p-2.5 text-accent">
                  <item.icon size={18} />
                </div>
                <h3 className="mt-3 font-semibold text-white">{item.title}</h3>
                <p className="mt-1.5 text-sm text-fg-muted">{item.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link
              href="/docs/frontend/overview"
              className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition hover:text-accent-strong">
              Explore usePages <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- Comparison ---------- */}
      <section className="mx-auto max-w-[90rem] px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            How Pylon compares
          </h2>
          <p className="mt-4 text-lg text-fg-muted">
            tRPC's developer experience. A real GraphQL API. A backend that ships
            with the parts you'd otherwise assemble yourself.
          </p>
        </div>
        <div className="mx-auto mt-12 max-w-5xl">
          <ComparisonTable />
          <p className="mt-4 text-center text-xs text-fg-subtle">
            <ListChecks size={12} className="mr-1 inline" />
            Comparison reflects each tool's primary, out-of-the-box design — many
            gaps can be closed with additional libraries.
          </p>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="mx-auto max-w-[90rem] px-6 py-16">
        <div className="glow-accent relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-bg-elevated to-bg-subtle px-8 py-14 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Build your next API in minutes
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-fg-muted">
            Scaffold a project, write a function, and get a typed GraphQL API with a
            playground — instantly.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition hover:bg-accent-strong">
              Read the docs <ArrowRight size={16} />
            </Link>
            <a
              href="https://github.com/getcronit/pylon"
              className="rounded-md border border-border-strong px-6 py-3 text-sm font-semibold text-fg transition hover:bg-bg-elevated">
              Star on GitHub
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}

export default Page
