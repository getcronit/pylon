import type {Plugin} from '@/index'
export type {Data, LayoutProps, MetadataRoute, PageProps} from './setup'

export function usePages(): Plugin {
  return {
    strategy: 'last',
    // We use async functions here so React isn't imported until setup() is called
    setup: async api => {
      const {setup} = await import('./setup')
      return setup(api)
    },
    build: async api => {
      const {build} = await import('./build')
      return build(api)
    }
  }
}
