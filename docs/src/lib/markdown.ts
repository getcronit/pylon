import {unified} from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkDirective from 'remark-directive'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeStringify from 'rehype-stringify'
import rehypeShiki from '@shikijs/rehype'
import {
  transformerNotationHighlight,
  transformerNotationDiff,
  transformerNotationFocus,
  transformerMetaHighlight
} from '@shikijs/transformers'
import {visit} from 'unist-util-visit'
import {toString as hastToString} from 'hast-util-to-string'

export interface Heading {
  depth: number
  id: string
  text: string
}

export interface RenderedMarkdown {
  html: string
  headings: Heading[]
}

const CALLOUTS: Record<string, {label: string}> = {
  note: {label: 'Note'},
  tip: {label: 'Tip'},
  info: {label: 'Info'},
  important: {label: 'Important'},
  warning: {label: 'Warning'},
  caution: {label: 'Caution'}
}

/**
 * Custom container directives:
 *   :::note / :::tip / :::warning ...  → styled callouts
 *   :::generates                       → side-by-side "you write → Pylon generates"
 */
function remarkPylonDirectives() {
  return (tree: any) => {
    visit(tree, (node: any) => {
      if (node.type !== 'containerDirective') return
      const name = node.name as string

      if (CALLOUTS[name]) {
        const data = node.data || (node.data = {})
        data.hName = 'div'
        data.hProperties = {className: ['callout', `callout-${name}`]}

        // Title: explicit label (`:::note[My title]`) or the default for the type.
        const first = node.children[0]
        if (first?.data?.directiveLabel) {
          first.data.hName = 'div'
          first.data.hProperties = {className: ['callout__title']}
        } else {
          node.children.unshift({
            type: 'paragraph',
            data: {hName: 'div', hProperties: {className: ['callout__title']}},
            children: [{type: 'text', value: CALLOUTS[name].label}]
          })
        }
        return
      }

      if (name === 'generates') {
        const data = node.data || (node.data = {})
        data.hName = 'div'
        data.hProperties = {className: ['generates']}
        // Insert an arrow between the two panels.
        const codeIndexes = node.children
          .map((c: any, i: number) => (c.type === 'code' ? i : -1))
          .filter((i: number) => i >= 0)
        if (codeIndexes.length === 2) {
          node.children.splice(codeIndexes[1], 0, {
            type: 'paragraph',
            data: {hName: 'div', hProperties: {className: ['generates__arrow']}},
            children: [{type: 'text', value: '→'}]
          })
        }
      }
    })
  }
}

/** Shiki transformer: lift the fenced `title="…"` meta onto the <pre>. */
function transformerCodeTitle() {
  return {
    name: 'pylon:title',
    pre(node: any) {
      const raw: string = (this as any).options?.meta?.__raw ?? ''
      const title = raw.match(/title="([^"]+)"/)?.[1]
      if (title) node.properties['data-title'] = title
      const lang = (this as any).options?.lang
      if (lang) node.properties['data-lang'] = lang
    }
  }
}

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'

/** Wrap each Shiki <pre> in a .code-block with an optional filename header and a copy button. */
function rehypeWrapCode() {
  return (tree: any) => {
    visit(tree, 'element', (node: any, index: number | undefined, parent: any) => {
      if (node.tagName !== 'pre' || index == null || !parent) return
      // Our Shiki transformer stamps every code block with data-lang; use that
      // as the match signal (robust to how the class list is represented).
      if (!node.properties?.['data-lang']) return
      // Skip a node we already wrapped.
      if (parent.properties?.className?.includes?.('code-block')) return

      const title = node.properties['data-title'] as string | undefined
      const children: any[] = []

      if (title) {
        children.push({
          type: 'element',
          tagName: 'div',
          properties: {className: ['code-block__header']},
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: {className: ['code-block__title']},
              children: [{type: 'text', value: title}]
            }
          ]
        })
      }

      const copyBtn = {
        type: 'element',
        tagName: 'button',
        properties: {
          className: ['code-copy'],
          type: 'button',
          'aria-label': 'Copy code'
        },
        children: [{type: 'raw', value: COPY_ICON}]
      }

      children.push(node, copyBtn)

      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['code-block', title ? 'code-block--titled' : 'code-block--bare']
        },
        children
      }
    })
  }
}

function rehypeCollectHeadings(headings: Heading[]) {
  return (tree: any) => {
    visit(tree, 'element', (node: any) => {
      const match = /^h([2-4])$/.exec(node.tagName ?? '')
      if (!match) return
      const id = node.properties?.id as string | undefined
      if (!id) return
      headings.push({
        depth: Number(match[1]),
        id,
        text: hastToString(node).replace(/#$/, '').trim()
      })
    })
  }
}

let base: any = null

function getBase() {
  if (!base) {
    base = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkDirective)
      .use(remarkPylonDirectives)
      .use(remarkRehype)
      .use(rehypeSlug)
      .use(rehypeAutolinkHeadings, {
        behavior: 'append',
        properties: {
          className: ['heading-anchor'],
          ariaHidden: true,
          tabIndex: -1
        },
        content: {type: 'text', value: '#'}
      })
      .use(rehypeShiki, {
        theme: 'github-dark-default',
        transformers: [
          transformerCodeTitle(),
          transformerMetaHighlight(),
          transformerNotationHighlight(),
          transformerNotationDiff(),
          transformerNotationFocus()
        ]
      })
      .use(rehypeWrapCode)
  }
  return base
}

export async function renderMarkdown(markdown: string): Promise<RenderedMarkdown> {
  const headings: Heading[] = []
  const file = await getBase()()
    .use(rehypeCollectHeadings, headings)
    .use(rehypeStringify, {allowDangerousHtml: true})
    .process(markdown)
  return {html: String(file), headings}
}
