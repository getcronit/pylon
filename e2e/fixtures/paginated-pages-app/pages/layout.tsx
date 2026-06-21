export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>paginated-pages-app</title>
      </head>
      <body>{children}</body>
    </html>
  )
}
