import {Suspense} from 'react'
import {ErrorBoundary, useData} from '@getcronit/pylon/pages'

// A widget whose read always fails, wrapped in a manually-composed <Suspense> (for a
// loading state) INSIDE an <ErrorBoundary> (for containment). This is the "add Suspense
// yourself" streaming pattern: the page content renders server-side (200), the widget
// slot streams its Suspense fallback, and React 19 renders the error on the client.
function FailingWidget() {
  const data = useData()
  return <div id="widget-body">widget:{data.boom}</div>
}

export default function WidgetPage() {
  return (
    <main id="widget-page">
      <p id="widget-sibling">sibling content stays</p>
      <ErrorBoundary fallback={({error}) => <div id="widget-error">failed:{error.message}</div>}>
        <Suspense fallback={<div id="widget-pending">loading widget</div>}>
          <FailingWidget />
        </Suspense>
      </ErrorBoundary>
    </main>
  )
}
