import {useLocale} from '@getcronit/pylon/pages'

export default function RootLayout({children}: {children: React.ReactNode}) {
  const {locale} = useLocale()
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  )
}
