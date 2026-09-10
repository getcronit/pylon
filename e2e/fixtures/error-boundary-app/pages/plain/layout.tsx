import {useData} from '@getcronit/pylon/pages'

// Same failing read as /dashboard, but this segment has NO error.tsx — so it exercises
// the DEFAULT per-layout boundary: the built-in GlobalErrorPage, rendered inside the
// surviving root chrome rather than replacing the whole document.
export default function PlainLayout({children}: {children: React.ReactNode}) {
  const data = useData()
  return (
    <section id="plain-chrome">
      plain:{data.boom}
      {children}
    </section>
  )
}
