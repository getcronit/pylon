/**
 * @getcronit/pylon-pages — the batteries-included FRONTEND for Pylon.
 *
 * Relocated out of core (which is now server/GraphQL-only and ships none of the
 * frontend/build deps — React, gqty, react-router, tailwind, sharp, the esbuild
 * page pipeline, the `useData` static analyzer). `usePages()` is the plugin: its
 * `setup` serves the SSR app and its `build` hook runs the page pipeline.
 *
 * Page components import the runtime (`useData`, `Link`, `Image`) from
 * `@getcronit/pylon-pages/pages` (the browser build), and the stylesheet from
 * `@getcronit/pylon-pages/pages/index.css`.
 */
export {
  usePages,
  type Data,
  type LayoutProps,
  type MetadataRoute,
  type PageProps
} from './plugins/use-pages/index.js'
