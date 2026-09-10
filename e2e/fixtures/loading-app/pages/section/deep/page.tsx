import {useData} from '@getcronit/pylon/pages'

// No own `loading.tsx` → inherits /section's (cascade). Its page must be wrapped in
// `withLoading(..., SectionLoading)` and use SectionLoading as HydrateFallback.
export default function DeepPage() {
  const data = useData()
  return <div id="deep-page">deep-page:{data.slow}</div>
}
