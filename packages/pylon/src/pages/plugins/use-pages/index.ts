import type {Plugin} from '@getcronit/pylon'
export type {Data, Mutations, LayoutProps, MetadataRoute, PageProps, PagesContext} from './types'

export interface UsePagesOptions {
  /**
   * Wire `@sentry/react` into the client hydration bundle for error reporting.
   * Opt-in — when enabled the app must have `@sentry/react` installed. Defaults
   * to `false`; disabled apps get a plain console error handler and never import
   * Sentry.
   */
  sentry?: boolean
}

export function usePages(options: UsePagesOptions = {}): Plugin {
  return {
    name: 'pages',
    strategy: 'last',
    // We use async functions here so React isn't imported until setup() is called
    setup: async api => {
      const {setup} = await import('./setup')
      return setup(api)
    },
    build: async api => {
      const {build} = await import('./build')
      return build(api, options)
    }
  }
}
