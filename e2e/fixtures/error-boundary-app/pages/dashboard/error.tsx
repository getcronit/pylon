// A segment-level error boundary. `error.tsx` alongside layout.tsx/page.tsx overrides
// the default crash UI for this segment. It receives the crash error and a `reset`.
export default function DashboardError({
  error,
  reset
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div id="dash-error">
      <p id="dash-error-message">{error.message}</p>
      <button id="dash-error-reset" onClick={reset}>
        retry
      </button>
    </div>
  )
}
