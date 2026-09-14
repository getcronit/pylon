'use client'

import {usePylonQueryClientOptional} from '@getcronit/pylon/query'
import React, {Component, useCallback, useState} from 'react'

/** Render-prop form of the fallback: receives the caught error and a `reset`. */
export type ErrorFallbackRender = (props: {
  error: Error
  reset: () => void
}) => React.ReactNode

export interface ErrorBoundaryProps {
  children: React.ReactNode
  /**
   * Rendered when a child throws. Either a static node, or a function receiving
   * `{error, reset}` — `reset` clears the failure and re-attempts the subtree.
   */
  fallback?: React.ReactNode | ErrorFallbackRender
  /** Called when a child throws — for telemetry. */
  onError?: (error: Error) => void
}

interface InnerProps {
  children: React.ReactNode
  fallback?: React.ReactNode | ErrorFallbackRender
  reset: () => void
  onError?: (error: Error) => void
}

class InnerBoundary extends Component<InnerProps, {error: Error | null}> {
  state: {error: Error | null} = {error: null}

  static getDerivedStateFromError(error: Error): {error: Error} {
    return {error}
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error)
  }

  render(): React.ReactNode {
    const {error} = this.state
    if (error) {
      const {fallback} = this.props
      return typeof fallback === 'function'
        ? fallback({error, reset: this.props.reset})
        : (fallback ?? null)
    }
    return this.props.children
  }
}

/**
 * A client-side error boundary for in-page (sub-route) UI.
 *
 * Deliberately does NOT introduce a `<Suspense>` boundary. That has two consequences
 * worth understanding, both of which are the intended design:
 *
 *  - A `useData` read inside it renders INLINE on the server (the read bubbles to the
 *    page's root suspension), so a successful read is fully server-rendered — no loading
 *    fallback, no client swap.
 *  - Because there is no local Suspense, a read that FAILS on the server escalates to the
 *    nearest ROUTE boundary (layout/page `error.tsx`), which IS server-rendered with the
 *    right status. React 19 cannot server-render an inline boundary's fallback, so this is
 *    the correct place for a server-side failure to surface. On the CLIENT the failure is a
 *    synchronous throw (`useData` throws the read error), which this boundary catches and
 *    renders as `fallback`.
 *
 * If you want a per-widget LOADING state (stream a placeholder, don't block on the read),
 * add your own `<Suspense fallback={…}>` around the children — it composes with this
 * boundary (Suspense streams the fallback; on failure it retries and this boundary catches
 * the error).
 *
 * ```tsx
 * // inline: server-rendered on success, route boundary on server failure, caught here on client
 * <ErrorBoundary fallback={({error, reset}) => <Failed message={error.message} onRetry={reset} />}>
 *   <RevenueWidget/>
 * </ErrorBoundary>
 *
 * // streaming: opt into a loading state by adding Suspense yourself
 * <ErrorBoundary fallback={({error}) => <Failed message={error.message}/>}>
 *   <Suspense fallback={<Spinner/>}>
 *     <SlowWidget/>
 *   </Suspense>
 * </ErrorBoundary>
 * ```
 */
export function ErrorBoundary({
  children,
  fallback,
  onError
}: ErrorBoundaryProps): React.ReactElement {
  const client = usePylonQueryClientOptional()
  const [attempt, setAttempt] = useState(0)

  const reset = useCallback(() => {
    // Drop the cached read errors so the remounted subtree re-fetches instead of
    // reading the same error straight back into the boundary; then remount (the
    // `key` bump) to clear the boundary's own error state and re-run the children.
    client?.clearErrors()
    setAttempt(a => a + 1)
  }, [client])

  return (
    <InnerBoundary key={attempt} fallback={fallback} reset={reset} onError={onError}>
      {children}
    </InnerBoundary>
  )
}
