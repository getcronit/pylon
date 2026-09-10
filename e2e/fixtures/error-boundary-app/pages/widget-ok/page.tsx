import {ErrorBoundary, useData} from '@getcronit/pylon/pages'

// A HEALTHY widget inside a bare <ErrorBoundary> (no Suspense). Its read succeeds, so
// its content MUST be server-rendered inline — no loading fallback, no client swap.
function OkWidget() {
  const data = useData()
  return <div id="okwidget-body">okwidget:{data.ok}</div>
}

export default function WidgetOkPage() {
  return (
    <main id="widget-ok-page">
      <ErrorBoundary fallback={({error}) => <div id="okwidget-error">{error.message}</div>}>
        <OkWidget />
      </ErrorBoundary>
    </main>
  )
}
