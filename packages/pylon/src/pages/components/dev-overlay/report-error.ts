import type {ErrorInfo} from './types'

// Define a global error store type
type ErrorStore = {
  error: Error | null
  errorInfo: ErrorInfo | null
  errorType: 'caught' | 'uncaught' | 'recoverable' | 'identifier' | null
  listeners: Set<(data: ErrorStoreData) => void>
}

// Data passed to listeners
type ErrorStoreData = {
  error: Error | null
  errorInfo: ErrorInfo | null
  errorType: 'caught' | 'uncaught' | 'recoverable' | 'identifier' | null
}

// Create a global error store
const errorStore: ErrorStore = {
  error: null,
  errorInfo: null,
  errorType: null,
  listeners: new Set()
}

// Function to report an error to the store
export function reportError(
  error: Error,
  errorInfo: ErrorInfo,
  errorType: 'caught' | 'uncaught' | 'recoverable' | 'identifier'
) {
  // Update the store
  errorStore.error = error
  errorStore.errorInfo = errorInfo
  errorStore.errorType = errorType

  // Notify all listeners
  const data: ErrorStoreData = {
    error: errorStore.error,
    errorInfo: errorStore.errorInfo,
    errorType: errorStore.errorType
  }

  errorStore.listeners.forEach(listener => {
    listener(data)
  })

  // Also log to console in development
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${errorType} error]:`, error)
    if (errorInfo.componentStack) {
      console.error('Component stack:', errorInfo.componentStack)
    }
  }
}

// Clear the current error
export function clearError() {
  errorStore.error = null
  errorStore.errorInfo = null
  errorStore.errorType = null

  // Notify all listeners
  const data: ErrorStoreData = {
    error: null,
    errorInfo: null,
    errorType: null
  }

  errorStore.listeners.forEach(listener => {
    listener(data)
  })
}

// Subscribe to error changes
export function subscribeToErrors(
  callback: (data: ErrorStoreData) => void
): () => void {
  errorStore.listeners.add(callback)

  // Return unsubscribe function
  return () => {
    errorStore.listeners.delete(callback)
  }
}

// Get current error state
export function getCurrentError(): ErrorStoreData {
  return {
    error: errorStore.error,
    errorInfo: errorStore.errorInfo,
    errorType: errorStore.errorType
  }
}

// Error handlers for React root
export const onCaughtErrorProd = (error: Error, errorInfo: ErrorInfo) => {
  reportError(error, errorInfo, 'caught')
}

export const onUncaughtErrorProd = (error: Error, errorInfo: ErrorInfo) => {
  reportError(error, errorInfo, 'uncaught')
}

export const onRecoverableErrorProd = (error: Error, errorInfo: ErrorInfo) => {
  reportError(error, errorInfo, 'recoverable')
}
