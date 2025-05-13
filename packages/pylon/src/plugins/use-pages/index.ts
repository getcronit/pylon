import {Plugin} from '@/index'
import {setup, PageData, PageProps} from './setup'
import {build} from './build'

export {PageData, PageProps}

export function usePages(): Plugin {
  return {
    strategy: 'last',
    setup,
    build
  }
}
