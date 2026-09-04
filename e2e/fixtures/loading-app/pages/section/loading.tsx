// The only `loading.tsx` in the app. It is the Suspense fallback for /section AND cascades
// to nested segments that don't define their own (e.g. /section/deep). The distinctive
// marker lets the serve test assert it NEVER appears in the buffered SSR HTML (the boundary
// is client-only in Phase 1) while still being shipped to the client bundle.
export default function SectionLoading() {
  return <div id="section-loading">SECTION-LOADING-FALLBACK</div>
}
