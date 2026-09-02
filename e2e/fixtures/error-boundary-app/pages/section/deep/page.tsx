import {useData} from '@getcronit/pylon/pages'

// A nested route with NO error.tsx of its own. When its read fails it must render the
// INHERITED /section/error.tsx (cascade), not the default error page.
export default function DeepPage() {
  const data = useData()
  return <div id="deep-page">deep:{data.boom}</div>
}
