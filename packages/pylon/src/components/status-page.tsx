import {Button} from './ui/button'

export interface StatusPageProps {
  code: number
  title: string
  message: string
  standalone?: boolean
  returnText?: string
  returnUrl?: string
}

export const StatusPage = ({
  code,
  title,
  message,
  standalone = false,
  returnText = 'Return to home',
  returnUrl = '/'
}: StatusPageProps) => {
  const element = (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-white p-4 text-center">
      <title>{title}</title>
      <h1 className="mb-2 text-9xl font-thin tracking-tight text-gray-900">
        {code}
      </h1>
      <h2 className="mb-6 text-xl font-light text-gray-600">{title}</h2>
      <p className="mb-8 max-w-md text-sm text-gray-500">{message}</p>
      <Button asChild>
        <a href={returnUrl}>{returnText}</a>
      </Button>
    </div>
  )

  if (standalone) {
    return (
      <html>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link
            rel="stylesheet"
            href="/__pylon/static/pylon.css"
            precedence="high"
          />
        </head>
        <body>{element}</body>
      </html>
    )
  }
  return element
}
