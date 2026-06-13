import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'

import {getDoc, getDocMetas, type DocMeta} from './lib/content.js'

// ---- GraphQL types (introspected from these classes) ---------------------

class Heading {
  depth!: number
  id!: string
  text!: string
}

class DocLink {
  slug!: string
  title!: string
}

class DocPage {
  slug!: string
  title!: string
  description!: string | null
  section!: string | null
  html!: string
  headings!: Heading[]
  editPath!: string
  prev!: DocLink | null
  next!: DocLink | null
}

class NavItem {
  slug!: string
  title!: string
}

class NavSection {
  title!: string
  items!: NavItem[]
}

// ---- Navigation model ----------------------------------------------------

/**
 * Explicit sidebar section order. Docs declare their section via frontmatter;
 * anything not listed here falls to the end (alphabetically).
 */
const SECTION_ORDER = [
  'Introduction',
  'Core Concepts',
  'Data — pylon-db',
  'Apps',
  'Frontend — usePages',
  'Production',
  'Guides',
  'Reference'
]

function sortMetas(a: DocMeta, b: DocMeta): number {
  if (a.order !== b.order) return a.order - b.order
  return a.title.localeCompare(b.title)
}

/** Flat, fully-ordered list of docs — drives the sidebar and prev/next. */
function orderedDocs(): DocMeta[] {
  const metas = getDocMetas()
  const sectionRank = (s: string | null) => {
    const i = SECTION_ORDER.indexOf(s ?? '')
    return i === -1 ? SECTION_ORDER.length : i
  }
  return metas.sort((a, b) => {
    const ra = sectionRank(a.section)
    const rb = sectionRank(b.section)
    if (ra !== rb) return ra - rb
    return sortMetas(a, b)
  })
}

function buildNav(): NavSection[] {
  const bySection = new Map<string, DocMeta[]>()
  for (const meta of orderedDocs()) {
    const key = meta.section ?? 'Reference'
    const list = bySection.get(key) ?? []
    list.push(meta)
    bySection.set(key, list)
  }

  const sections: NavSection[] = []
  for (const title of SECTION_ORDER) {
    const items = bySection.get(title)
    if (!items?.length) continue
    sections.push({
      title,
      items: items.map(m => ({slug: m.slug, title: m.navLabel}))
    })
    bySection.delete(title)
  }
  // Append any leftover sections not in SECTION_ORDER.
  for (const [title, items] of bySection) {
    sections.push({
      title,
      items: items.map(m => ({slug: m.slug, title: m.navLabel}))
    })
  }
  return sections
}

// ---- Resolvers -----------------------------------------------------------

export const graphql = {
  Query: {
    docPage: async (slug: string): Promise<DocPage | null> => {
      const doc = await getDoc(slug)
      if (!doc) return null

      const flat = orderedDocs()
      const idx = flat.findIndex(d => d.slug === doc.slug)
      const prevMeta = idx > 0 ? flat[idx - 1] : null
      const nextMeta = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null

      return {
        slug: doc.slug,
        title: doc.title,
        description: doc.description,
        section: doc.section,
        html: doc.html,
        headings: doc.headings,
        editPath: doc.editPath,
        prev: prevMeta ? {slug: prevMeta.slug, title: prevMeta.navLabel} : null,
        next: nextMeta ? {slug: nextMeta.slug, title: nextMeta.navLabel} : null
      }
    },

    navTree: (): NavSection[] => buildNav()
  },
  Mutation: {}
}

serve(
  {fetch: app.fetch, port: Number(process.env.PORT) || 3000},
  info => {
    console.log(`Pylon docs running at http://localhost:${info.port}`)
  }
)
