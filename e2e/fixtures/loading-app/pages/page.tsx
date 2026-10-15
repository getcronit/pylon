import {useData} from '@getcronit/pylon/pages'

// No `loading.tsx` anywhere in this segment's chain → no Suspense boundary is generated
// for it (no `withLoading`, default `HydrateFallback`). Proves absence is the opt-out.
export default function HomePage() {
  const data = useData()
  return <main id="home">home:{data.ok}</main>
}
