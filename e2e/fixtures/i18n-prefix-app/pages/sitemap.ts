import type {MetadataRoute} from '@getcronit/pylon/pages'

// Declared once, in the default locale. The framework expands each into one entry per
// locale — a sitemap listing only /pricing would tell crawlers the other locales do not
// exist. `/fr/about` is written prefixed on purpose: an explicit URL is left verbatim.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {url: '/', changefreq: 'daily', priority: 1},
    {url: '/pricing', lastmod: '2026-01-01'},
    {url: '/fr/about'}
  ]
}
