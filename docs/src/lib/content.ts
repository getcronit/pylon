import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import {renderMarkdown, type Heading} from './markdown.js'

export const CONTENT_DIR = path.join(process.cwd(), 'content')
/** Docs live under content/docs; the URL keeps the leading `/docs/...`. */
const DOCS_ROOT = path.join(CONTENT_DIR, 'docs')

export interface DocFrontmatter {
  title?: string
  description?: string
  /** Sidebar group label. */
  section?: string
  /** Sort order within a section (lower first). */
  order?: number
  /** Override the sidebar label (defaults to title). */
  nav?: string
  draft?: boolean
}

export interface DocFile {
  slug: string
  title: string
  description: string | null
  section: string | null
  order: number
  navLabel: string
  html: string
  headings: Heading[]
  /** Repo-relative path for "edit this page" links. */
  editPath: string
}

export interface DocMeta {
  slug: string
  title: string
  navLabel: string
  section: string | null
  order: number
}

// ---- slug <-> file helpers ----------------------------------------------

/** Normalize an incoming slug to a leading-slash, no-trailing-slash form. */
function normalizeSlug(slug: string): string {
  let s = '/' + slug.replace(/^\/+/, '').replace(/\/+$/, '')
  if (s === '/') s = '/docs'
  return s
}

/** Resolve a slug like `/docs/getting-started` to an on-disk .md file. */
function resolveFile(slug: string): string | null {
  const rel = slug.replace(/^\//, '') // e.g. "docs/getting-started"
  const candidates = [
    path.join(CONTENT_DIR, `${rel}.md`),
    path.join(CONTENT_DIR, rel, 'index.md')
  ]
  for (const file of candidates) {
    // Guard against path traversal — resolved file must stay under CONTENT_DIR.
    const resolved = path.resolve(file)
    if (!resolved.startsWith(CONTENT_DIR)) continue
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved
  }
  return null
}

/** Map an on-disk file back to its slug. */
function fileToSlug(file: string): string {
  const rel = path.relative(CONTENT_DIR, file).replace(/\\/g, '/')
  const noExt = rel.replace(/\.md$/, '').replace(/\/index$/, '')
  return '/' + noExt
}

// ---- caching -------------------------------------------------------------

const docCache = new Map<string, {mtimeMs: number; doc: DocFile}>()
const fmCache = new Map<string, {mtimeMs: number; fm: DocFrontmatter}>()

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

function readFrontmatter(file: string): DocFrontmatter {
  const mtimeMs = fs.statSync(file).mtimeMs
  const cached = fmCache.get(file)
  if (cached && cached.mtimeMs === mtimeMs) return cached.fm
  const {data} = matter(fs.readFileSync(file, 'utf8'))
  const fm = data as DocFrontmatter
  fmCache.set(file, {mtimeMs, fm})
  return fm
}

function titleFromSlug(slug: string): string {
  const last = slug.split('/').filter(Boolean).pop() ?? 'Untitled'
  return last
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ---- public API ----------------------------------------------------------

/** Read + render a single doc by slug. Cached by file mtime. */
export async function getDoc(slug: string): Promise<DocFile | null> {
  const file = resolveFile(normalizeSlug(slug))
  if (!file) return null

  const mtimeMs = fs.statSync(file).mtimeMs
  const cached = docCache.get(file)
  if (cached && cached.mtimeMs === mtimeMs) return cached.doc

  const raw = fs.readFileSync(file, 'utf8')
  const {data, content} = matter(raw)
  const fm = data as DocFrontmatter
  const realSlug = fileToSlug(file)
  // The page title/description come from frontmatter and are rendered as the
  // page header, so drop a leading `# Title` from the body to avoid a duplicate.
  const body = content.replace(/^\s*#\s+.+\n+/, '')
  const {html, headings} = await renderMarkdown(body)

  const doc: DocFile = {
    slug: realSlug,
    title: fm.title ?? titleFromSlug(realSlug),
    description: fm.description ?? null,
    section: fm.section ?? null,
    order: fm.order ?? 100,
    navLabel: fm.nav ?? fm.title ?? titleFromSlug(realSlug),
    html,
    headings,
    editPath: path.relative(process.cwd(), file).replace(/\\/g, '/')
  }

  docCache.set(file, {mtimeMs, doc})
  return doc
}

/** All docs as lightweight metadata, ordered by (section, order, title). */
export function getDocMetas(): DocMeta[] {
  const metas: DocMeta[] = walk(DOCS_ROOT)
    .map(file => {
      const fm = readFrontmatter(file)
      if (fm.draft) return null
      const slug = fileToSlug(file)
      return {
        slug,
        title: fm.title ?? titleFromSlug(slug),
        navLabel: fm.nav ?? fm.title ?? titleFromSlug(slug),
        section: fm.section ?? null,
        order: fm.order ?? 100
      } satisfies DocMeta
    })
    .filter((m): m is DocMeta => m !== null)

  return metas
}
