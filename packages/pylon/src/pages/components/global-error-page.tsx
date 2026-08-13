import Logo from '@/components/logo'
import {useEffect} from 'react'

interface GlobalErrorProps {
  error: Error & {digest?: string}
  standalone?: boolean
}

export default function GlobalError({
  error,
  standalone = true,
  ...rest
}: GlobalErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Global error:', error)
  }, [error])

  const reset = () => {
    window.location.reload()
  }

  const manifest = (globalThis as any).__PYLON_MANIFEST__

  // Dev only: surface the REAL cause. A GQtyError's `.message` is just
  // "GraphQL Errors, please check .graphQLErrors property" — the actual failures
  // (resolver message + field path) live on `.graphQLErrors`. Show them (and the
  // stack) so a failing page is debuggable in the browser. Prod keeps it minimal.
  const isDev = process.env.NODE_ENV !== 'production'
  const graphQLErrors = (error as any)?.graphQLErrors as
    | Array<{message?: string; path?: Array<string | number>}>
    | undefined

  const content = (
    <div className="fixed inset-0 bg-black/90 z-50 overflow-y-auto p-4 flex items-center justify-center">
      <div className="w-full max-w-3xl bg-black border border-red-600 rounded-lg overflow-hidden text-white font-sans">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 p-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <Logo className="h-8 w-auto text-white" />
            </div>
            <div>
              <h1 className="text-xl font-medium text-red-500">
                Application Crashed
              </h1>
            </div>
          </div>
        </div>

        {/* Error Message */}
        <div className="p-4">
          <div className="mb-4 text-neutral-400">
            The application encountered a critical error and could not continue.
          </div>

          <h2 className="text-2xl font-bold mb-4 text-white">
            {error.message || 'A critical error occurred'}
          </h2>

          {error.digest && (
            <div className="mb-4">
              <h3 className="text-sm uppercase tracking-wider text-neutral-500 font-medium mb-2">
                Error ID
              </h3>
              <div className="bg-neutral-900 rounded-md p-3 text-neutral-300 font-mono">
                {error.digest}
              </div>
            </div>
          )}

          {isDev && graphQLErrors && graphQLErrors.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm uppercase tracking-wider text-neutral-500 font-medium mb-2">
                GraphQL Errors
              </h3>
              <div className="bg-neutral-900 rounded-md p-3 space-y-2">
                {graphQLErrors.map((e, i) => (
                  <div key={i} className="font-mono text-sm">
                    <div className="text-red-400">
                      {e.message || 'Unknown error'}
                    </div>
                    {e.path && e.path.length > 0 && (
                      <div className="text-neutral-500">
                        at {e.path.join('.')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isDev && error.stack && (
            <div className="mb-4">
              <h3 className="text-sm uppercase tracking-wider text-neutral-500 font-medium mb-2">
                Stack
              </h3>
              <pre className="bg-neutral-900 rounded-md p-3 text-neutral-400 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                {error.stack}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (standalone) {
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {manifest?.['index.css'] && (
            <link
              rel="stylesheet"
              href={manifest['index.css']}
              precedence="high"
            />
          )}
        </head>
        <body>{content}</body>
      </html>
    )
  }

  return content
}
