import {Button} from './ui/button'

export interface StatusPageProps {
  code: number
  message?: string
  error?: any
  standalone?: boolean
  returnText?: string
  returnUrl?: string
}

export const StatusPage = ({
  code,
  message: initialMessage,
  error,
  standalone = false,
  returnText = 'Return to home',
  returnUrl = '/'
}: StatusPageProps) => {
  let message = initialMessage || 'An unexpected error occurred'

  if (error) {
    const errorData = (error as any).data
    if (errorData) {
      try {
        const parsed =
          typeof errorData === 'string' ? JSON.parse(errorData) : errorData
        message = parsed.message || message
      } catch (e) {
        // Fallback to initial message
      }
    }
  }
  const element = (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-white p-4 text-center">
      <title>{message}</title>
      <h1 className="mb-2 text-9xl font-thin tracking-tight text-gray-900">
        {code}
      </h1>
      <h2 className="mb-6 text-xl font-light text-gray-600">{message}</h2>
      <Button asChild>
        <a href={returnUrl}>{returnText}</a>
      </Button>
    </div>
  )

  const manifest = (globalThis as any).__PYLON_MANIFEST__

  if (standalone) {
    return (
      <html>
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
        <body>{element}</body>
      </html>
    )
  }
  return element
}
