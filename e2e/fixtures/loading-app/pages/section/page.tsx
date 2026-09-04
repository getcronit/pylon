import {useData} from '@getcronit/pylon/pages'

// Segment WITH its own `loading.tsx` → its page is wrapped in `withLoading(..., SectionLoading)`.
// Reads the slow field so the boundary suspends and its fallback streams in the shell.
export default function SectionPage() {
  const data = useData()
  return <div id="section-page">section-page:{data.slow}</div>
}
