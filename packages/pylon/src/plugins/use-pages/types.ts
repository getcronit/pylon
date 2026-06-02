import type {Variables} from '@/index'
import type React from 'react'

export interface Data {
  $refetch: (ignoreCache?: boolean) => Promise<void>
}

export type PageProps = {
  // @ts-expect-error
  context: Variables['pagesContext']
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
