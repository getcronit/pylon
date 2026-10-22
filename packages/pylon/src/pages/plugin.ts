/**
 * @getcronit/pylon/pages — the batteries-included FRONTEND for Pylon.
 *
 * Relocated out of core (which is now server/GraphQL-only and ships none of the
 * frontend/build deps — React, pylon-query, react-router, tailwind, sharp, the esbuild
 * page pipeline, the `useData` static analyzer). `usePages()` is the plugin: its
 * `setup` serves the SSR app and its `build` hook runs the page pipeline.
 *
 * Page components import the runtime (`useData`, `Link`, `Image`) from
 * `@getcronit/pylon/pages` (the browser build), and the stylesheet from
 * `@getcronit/pylon/pages/index.css`.
 */
export {
  usePages,
  hasLocale,
  type Data,
  type LayoutProps,
  type MetadataRoute,
  type PageProps,
  type PagesContext,
  type I18nOptions,
  type I18nContext,
  type LocaleRouting,
  type LocalePrefix,
  type CatalogSource
} from './plugins/use-pages/index.js'

export {
  useRequestContext,
  type RequestContextOptions
} from './plugins/use-request-context.js'
