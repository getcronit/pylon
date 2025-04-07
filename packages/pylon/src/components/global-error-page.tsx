import {useEffect} from 'react'
import Logo from '@/components/logo'
import {Button} from '@/components/ui/button'

interface GlobalErrorProps {
  error: Error & {digest?: string}
}

export default function GlobalError({error, ...rest}: GlobalErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Global error:', error)
  }, [error])

  const reset = () => {
    window.location.reload()
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="stylesheet"
          href="/__pylon/static/pylon.css"
          precedence="high"
        />
      </head>
      <body>
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
                The application encountered a critical error and could not
                continue.
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
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
