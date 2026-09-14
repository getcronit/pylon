import type {Variables} from '@getcronit/pylon'
import type React from 'react'

export interface Data {
  $refetch: (ignoreCache?: boolean) => Promise<void>
}

/**
 * The Mutation root, augmented by the generated client (callable-field style:
 * `createUser(args): User`). `useMutation('createUser')` keys off `keyof Mutations`.
 */
export interface Mutations {}

/**
 * The request-scoped value a `useRequestContext()` plugin put on the Hono context, as seen
 * by pages. It is the SAME object on the server and in the browser — the SSR render reads
 * `c.get('pagesContext')` and serialises it into `window.__pylonStaticData.context`.
 *
 * Apps declare its shape by augmenting `Variables`:
 *
 * ```ts
 * // pylon.d.ts
 * declare module '@getcronit/pylon' {
 *   interface Variables {
 *     pagesContext: {theme: 'light' | 'dark'; sidebarOpen: boolean}
 *   }
 * }
 * ```
 *
 * Undeclared, it is `unknown` — narrow it, or declare it. It used to be
 * `Variables['pagesContext']` behind a `@ts-expect-error`, which silently made it `any`.
 */
type PagesContextOf<V> = 'pagesContext' extends keyof V ? V['pagesContext'] : unknown
export type PagesContext = PagesContextOf<Variables>

export type PageProps = {
  context: PagesContext
  params: Record<string, string | string[] | undefined>
  searchParams: Record<string, string>
  path: string
}

export type LayoutProps = PageProps & {
  children: React.ReactNode
}

export namespace MetadataRoute {
  export type SitemapItem = {
    url: string
    lastmod?: string | Date
    changefreq?:
      | 'always'
      | 'hourly'
      | 'daily'
      | 'weekly'
      | 'monthly'
      | 'yearly'
      | 'never'
    priority?: number
  }
  export type Sitemap = SitemapItem[]

  export type SitemapIndexItem = {
    url: string
    lastmod?: string | Date
  }
  export type SitemapIndex = SitemapIndexItem[]
}
