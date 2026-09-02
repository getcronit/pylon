// The root custom 404. It replaces the built-in NotFoundPage for unmatched paths, and
// cascades to nested segments (e.g. /section/*) that don't define their own.
export default function RootNotFound() {
  return <div id="root-not-found">custom-404</div>
}
