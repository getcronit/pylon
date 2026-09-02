import {useData} from '@getcronit/pylon/pages'

// The failing read lives in the LEAF page (no layout data). The failure must be
// attributed to the leaf — its own boundary renders inside the root chrome, NOT the
// whole document. Proves attribution isn't hardcoded to "the layout".
export default function LeafPage() {
  const data = useData()
  return <div id="leaf-page">leaf:{data.boom}</div>
}
