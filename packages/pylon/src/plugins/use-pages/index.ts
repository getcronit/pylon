import {Plugin} from '@/index'
import {setup, PageData, PageProps, LayoutProps} from './setup'
import {build} from './build'

export {PageData, PageProps, LayoutProps}

export function usePages(): Plugin {
  return {
    strategy: 'last',
    setup,
    build
  }
}
