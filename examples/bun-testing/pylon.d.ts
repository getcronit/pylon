import '@getcronit/pylon'
import {useQuery} from './.pylon/client'

declare module '@getcronit/pylon' {
  interface Bindings {}

  interface Variables {}

  interface PageData extends ReturnType<typeof useQuery> {}
}
