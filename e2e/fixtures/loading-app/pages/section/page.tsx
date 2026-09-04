import {useData} from '@getcronit/pylon/pages'

// Segment WITH its own `loading.tsx` → its page is wrapped in `withLoading(..., SectionLoading)`.
export default function SectionPage() {
  const data = useData()
  return <div id="section-page">section-page:{data.ok}</div>
}
