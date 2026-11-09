import {useData} from '@getcronit/pylon/pages'

// Sibling of /section with NO `loading.tsx` in its chain → no boundary generated. Confirms
// the cascade does not leak across siblings.
export default function PlainPage() {
  const data = useData()
  return <div id="plain-page">plain-page:{data.ok}</div>
}
