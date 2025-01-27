import { Plugin } from '../..'
import { onApp, PageData, PageProps } from './on-app'
import { onBuild } from './on-build'

export { PageData, PageProps }

export function usePages(args: {}): Plugin {
  return {
    onApp,
    onBuild
  }
}
