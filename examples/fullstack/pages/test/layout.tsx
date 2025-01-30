import {Link} from 'react-router'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-red-100">
      <Link to="/">Home</Link>
       {children}
    </div>
  )
}