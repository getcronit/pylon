 export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body id="test1234" className="bg-gray-100">
        {children}
       
      </body>
    </html>
  )
}