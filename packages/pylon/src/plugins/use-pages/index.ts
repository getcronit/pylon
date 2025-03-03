import {Plugin} from '../..'
import {setup, PageData, PageProps} from './setup'
import {build} from './build'

export {PageData, PageProps}

export function usePages(): Plugin {
  return {
    setup,
    build
  }
}
