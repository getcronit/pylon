import {Link, useData, type PageProps} from '@getcronit/pylon/pages'
import {Sidebar, type NavSection} from '@/components/docs/sidebar'
import {MobileDocsNav} from '@/components/docs/mobile-docs-nav'
import {Toc, type TocHeading} from '@/components/docs/toc'
import {Pager} from '@/components/docs/pager'
import {useDocsEnhancers} from '@/components/docs/enhancers'

const DocsPage: React.FC<PageProps> = ({params, path}) => {
  // Plain string identifier on its own line — the build-time useData analyzer
  // resolves simple identifiers cleanly and carries the runtime value into the
  // GraphQL argument.
  const slugParam = params.slug
  const slug =
    '/docs/' + (Array.isArray(slugParam) ? slugParam.join('/') : slugParam ?? '')

  useDocsEnhancers(slug)

  const data = useData()
  const navProxy = data.navTree
  const doc = data.docPage({slug})

  // Materialize plain objects from the gqty proxies so presentational
  // components stay decoupled from the data layer.
  const nav: NavSection[] = navProxy.map(s => ({
    title: s.title,
    items: s.items.map(i => ({slug: i.slug, title: i.title}))
  }))

  if (!doc) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="mt-3 text-fg-muted">
          No document exists at <code>{slug}</code>.
        </p>
        <Link href="/docs/getting-started" className="mt-6 inline-block text-accent">
          ← Back to the docs
        </Link>
      </div>
    )
  }

  const headings: TocHeading[] = doc.headings.map(h => ({
    depth: h.depth,
    id: h.id,
    text: h.text
  }))
  const prev = doc.prev ? {slug: doc.prev.slug, title: doc.prev.title} : null
  const next = doc.next ? {slug: doc.next.slug, title: doc.next.title} : null
  const html = doc.html
  const section = doc.section
  const title = doc.title
  const description = doc.description

  return (
    <div className="mx-auto grid max-w-[90rem] grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[16rem_minmax(0,1fr)_14rem]">
      <aside className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-10">
          <Sidebar nav={nav} currentPath={path} />
        </div>
      </aside>

      <article className="min-w-0">
        <MobileDocsNav nav={nav} currentPath={path} />
        {section && (
          <div className="mb-2 text-sm font-medium text-accent">{section}</div>
        )}
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
          {description && (
            <p className="mt-3 text-lg text-fg-muted">{description}</p>
          )}
        </header>

        <div className="prose" dangerouslySetInnerHTML={{__html: html}} />

        <Pager prev={prev} next={next} />
      </article>

      <aside className="hidden lg:block">
        <div className="sticky top-20">
          <Toc headings={headings} />
        </div>
      </aside>
    </div>
  )
}

export default DocsPage
