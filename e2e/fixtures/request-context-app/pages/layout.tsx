import {useResponseCookies, type LayoutProps} from '@getcronit/pylon/pages'

export default function RootLayout({children, context}: LayoutProps) {
  const {theme, locale, seen} = context as {
    theme: string
    locale: string
    seen: boolean
  }

  // Persist a first-visit marker FROM THE RENDER. Conditional, so a return visit queues
  // nothing — and idempotent, which is the contract for writing during render.
  const cookies = useResponseCookies()
  if (!seen) {
    cookies.set('seen', '1', {path: '/', maxAge: 31536000, sameSite: 'Lax'})
  }

  return (
    <html lang={locale} className={theme === 'dark' ? 'dark' : undefined}>
      <body>{children}</body>
    </html>
  )
}
