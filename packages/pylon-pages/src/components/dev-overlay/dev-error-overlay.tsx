'use client'

import type React from 'react'

import {useEffect, useState} from 'react'
import {X} from 'lucide-react'

interface ErrorInfo {
  componentStack?: string
  digest?: string
}

interface DevErrorOverlayProps {
  error: Error
  errorInfo: ErrorInfo
  errorType: 'caught' | 'uncaught' | 'recoverable' | 'identifier'
  onCaughtError?: (error: Error, errorInfo: ErrorInfo) => void
  onUncaughtError?: (error: Error, errorInfo: ErrorInfo) => void
  onRecoverableError?: (error: Error, errorInfo: ErrorInfo) => void
  identifierPrefix?: string
  onDismiss?: () => void
  logo?: React.ReactNode | string
}

export default function DevErrorOverlay({
  error,
  errorInfo,
  errorType,
  onCaughtError,
  onUncaughtError,
  onRecoverableError,
  identifierPrefix,
  onDismiss,
  logo
}: DevErrorOverlayProps) {
  const [isVisible, setIsVisible] = useState(true)

  // Call the appropriate callback based on error type
  useEffect(() => {
    if (errorType === 'caught' && onCaughtError) {
      onCaughtError(error, errorInfo)
    } else if (errorType === 'uncaught' && onUncaughtError) {
      onUncaughtError(error, errorInfo)
    } else if (errorType === 'recoverable' && onRecoverableError) {
      onRecoverableError(error, errorInfo)
    }
  }, [
    error,
    errorInfo,
    errorType,
    onCaughtError,
    onUncaughtError,
    onRecoverableError
  ])

  const handleDismiss = () => {
    setIsVisible(false)
    if (onDismiss) onDismiss()
  }

  if (!isVisible || !error) {
    return null
  }

  const getErrorTypeLabel = () => {
    switch (errorType) {
      case 'caught':
        return 'Error Boundary Caught Error'
      case 'uncaught':
        return 'Uncaught Error'
      case 'recoverable':
        return 'Recoverable Error'
      case 'identifier':
        return 'Identifier Prefix Error'
      default:
        return 'Runtime Error'
    }
  }

  const getErrorTypeDescription = () => {
    switch (errorType) {
      case 'caught':
        return 'This error was caught by a React Error Boundary.'
      case 'uncaught':
        return 'This error was not caught by any Error Boundary and crashed your application.'
      case 'recoverable':
        return 'React automatically recovered from this error, but you should still fix it.'
      case 'identifier':
        return `Identifier prefix mismatch. Expected prefix: "${identifierPrefix}".`
      default:
        return 'An unexpected error occurred during runtime.'
    }
  }

  const getErrorBorderColor = () => {
    switch (errorType) {
      case 'caught':
        return 'border-yellow-600'
      case 'uncaught':
        return 'border-red-600'
      case 'recoverable':
        return 'border-blue-600'
      case 'identifier':
        return 'border-purple-600'
      default:
        return 'border-red-600'
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 overflow-y-auto p-4 flex items-start justify-center">
      <link
        rel="stylesheet"
        href="/__pylon/static/pylon.css"
        precedence="high"
      />
      <div
        className={`w-full max-w-3xl bg-black border ${getErrorBorderColor()} rounded-lg mt-16 overflow-hidden text-white font-sans`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 p-4">
          <div className="flex items-center gap-3">
            {logo && (
              <div className="flex-shrink-0">
                {typeof logo === 'string' ? (
                  <img
                    src={logo || '/placeholder.svg'}
                    alt="Error Overlay Logo"
                    className="h-8 w-auto"
                  />
                ) : (
                  logo
                )}
              </div>
            )}
            <div>
              <h1 className="text-xl font-medium text-red-500">
                {getErrorTypeLabel()}
              </h1>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-2 rounded-full hover:bg-neutral-800 transition-colors"
            aria-label="Dismiss error overlay">
            <X className="h-5 w-5 text-neutral-400" />
          </button>
        </div>

        {/* Error Message */}
        <div className="p-4">
          <div className="mb-4 text-neutral-400">
            {getErrorTypeDescription()}
          </div>

          <h2 className="text-2xl font-bold mb-4 text-white">
            {error.message || 'An unexpected error has occurred'}
          </h2>

          {!!error.cause && (
            <div className="mb-4">
              <h3 className="text-sm uppercase tracking-wider text-neutral-500 font-medium mb-2">
                Cause
              </h3>
              <div className="bg-neutral-900 rounded-md p-3 text-neutral-300">
                {String(error.cause)}
              </div>
            </div>
          )}
        </div>

        {/* Component Stack */}
        {errorInfo?.componentStack && (
          <div className="p-4 border-t border-neutral-800">
            <h3 className="text-sm uppercase tracking-wider text-neutral-500 font-medium mb-3">
              Component Stack
            </h3>
            <div className="bg-neutral-900 rounded-md p-4 overflow-x-auto">
              <pre className="font-mono text-sm text-neutral-300 whitespace-pre-wrap">
                {errorInfo.componentStack}
              </pre>
            </div>
          </div>
        )}

        {/* Call Stack */}
        <div className="p-4 border-t border-neutral-800">
          <h3 className="text-sm uppercase tracking-wider text-neutral-500 font-medium mb-3">
            Call Stack
          </h3>
          <div className="bg-neutral-900 rounded-md p-4 overflow-x-auto">
            <pre className="font-mono text-sm text-neutral-300 whitespace-pre-wrap">
              {error.stack || 'No stack trace available'}
            </pre>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-neutral-800 flex justify-between">
          <div>
            {errorType === 'recoverable' && (
              <span className="text-blue-400 text-sm">
                React automatically recovered from this error
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleDismiss}
              className="bg-neutral-800 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-neutral-700 transition-colors">
              Dismiss
            </button>
            <button
              onClick={() => window.location.reload()}
              className="bg-white text-black px-4 py-2 rounded-md text-sm font-medium hover:bg-neutral-200 transition-colors">
              Reload Page
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
