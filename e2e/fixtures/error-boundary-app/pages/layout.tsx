export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <header id="root-chrome">root-chrome</header>
        {children}
      </body>
    </html>
  )
}
