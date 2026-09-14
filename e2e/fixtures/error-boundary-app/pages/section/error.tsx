// The ONLY error.tsx in the /section subtree. It must cascade to nested segments
// (e.g. /section/deep) that don't define their own — otherwise adding a route silently
// falls back to the default error page.
export default function SectionError({error}: {error: Error}) {
  return <div id="section-error">section-error:{error.message}</div>
}
