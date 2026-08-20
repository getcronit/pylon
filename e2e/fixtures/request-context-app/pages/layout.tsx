import type {LayoutProps} from '@getcronit/pylon/pages'

export default function RootLayout({children, context}: LayoutProps) {
  const {theme, locale} = context as {theme: string; locale: string}
  return (
    <html lang={locale} className={theme === 'dark' ? 'dark' : undefined}>
      <body>{children}</body>
    </html>
  )
}
