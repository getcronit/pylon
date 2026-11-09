export interface ErrorInfo {
  componentStack?: string | null
  digest?: string
}

export type ErrorType =
  | 'caught'
  | 'uncaught'
  | 'recoverable'
  | 'identifier'
  | null

export interface ErrorCallbacks {
  onCaughtError?: (error: Error, errorInfo: ErrorInfo) => void
  onUncaughtError?: (error: Error, errorInfo: ErrorInfo) => void
  onRecoverableError?: (error: Error, errorInfo: ErrorInfo) => void
}
