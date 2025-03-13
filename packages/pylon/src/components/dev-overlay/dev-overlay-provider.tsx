import Logo from '@/components/logo'
import type React from 'react'
import {useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import DevErrorOverlay from './dev-error-overlay'
import {ErrorBoundary} from './error-boundary'
import {clearError, getCurrentError, subscribeToErrors} from './report-error'

interface ErrorOverlayProviderProps {
  children: React.ReactNode
  identifierPrefix?: string
}

export default function DevOverlayProvider({
  children,
  identifierPrefix
}: ErrorOverlayProviderProps) {
  const [error, setError] = useState<Error | null>(null)
  const [errorInfo, setErrorInfo] = useState<any | null>(null)
  const [errorType, setErrorType] = useState<
    'caught' | 'uncaught' | 'recoverable' | 'identifier' | null
  >(null)
  const [overlayContainer, setOverlayContainer] = useState<HTMLElement | null>(
    null
  )

  useEffect(() => {
    // Check for existing errors on mount
    const currentError = getCurrentError()
    if (currentError.error) {
      setError(currentError.error)
      setErrorInfo(currentError.errorInfo)
      setErrorType(currentError.errorType)
    }

    // Create a container for the overlay that lives outside the React tree
    const container = document.createElement('div')
    container.id = 'dev-error-overlay-container'
    document.body.appendChild(container)
    setOverlayContainer(container)

    // Subscribe to future errors
    const unsubscribe = subscribeToErrors(data => {
      setError(data.error)
      setErrorInfo(data.errorInfo)
      setErrorType(data.errorType)
    })

    // Cleanup
    return () => {
      unsubscribe()
      document.body.removeChild(container)
    }
  }, [])

  const handleDismiss = () => {
    clearError()
    setError(null)
    setErrorInfo(null)
    setErrorType(null)
  }

  return (
    <>
      <ErrorBoundary>{children}</ErrorBoundary>

      {overlayContainer &&
        error &&
        errorInfo &&
        errorType &&
        createPortal(
          <DevErrorOverlay
            logo={<Logo />}
            error={error}
            errorInfo={errorInfo}
            errorType={errorType}
            onDismiss={handleDismiss}
            identifierPrefix={identifierPrefix}
            onCaughtError={(e, i) => console.log('Overlay caught error:', e, i)}
            onUncaughtError={(e, i) =>
              console.log('Overlay uncaught error:', e, i)
            }
            onRecoverableError={(e, i) =>
              console.log('Overlay recoverable error:', e, i)
            }
          />,
          overlayContainer
        )}
    </>
  )
}
