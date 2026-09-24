import {notFound} from '@getcronit/pylon/pages'

// Throws notFound() — a 404 that surfaces through the errorElement, NOT the
// unmatched-path catch-all. It must still render the custom not-found.tsx (inherited
// from the root), not the built-in StatusPage. This is the common 404 path in an app
// whose catch-all matches every path.
export default function GonePage() {
  notFound('this entity is gone')
  return null
}
