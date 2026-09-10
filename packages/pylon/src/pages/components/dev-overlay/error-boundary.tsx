'use client'

import type React from 'react'
import {Component, type ErrorInfo as ReactErrorInfo} from 'react'
import {onCaughtErrorProd} from './report-error'
import type {ErrorInfo} from './types'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {hasError: false}
  }

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return {hasError: true}
  }

  componentDidCatch(error: Error, errorInfo: ReactErrorInfo): void {
    // Convert React's errorInfo to our ErrorInfo format
    const customErrorInfo: ErrorInfo = {
      componentStack: errorInfo.componentStack
    }

    // Report the error to our error reporting system
    onCaughtErrorProd(error, customErrorInfo)

    // You can also log the error to an error reporting service
    console.error('Error caught by boundary:', error, errorInfo)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return this.props.fallback || null
    }

    return this.props.children
  }
}
