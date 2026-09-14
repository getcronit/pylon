import {useData} from '@getcronit/pylon/pages'

// This nested layout reads a field whose resolver always throws. The read surfaces the
// failure as a render-time throw. It must be contained by THIS segment's boundary
// (dashboard/error.tsx) — the root chrome must survive.
export default function DashboardLayout({children}: {children: React.ReactNode}) {
  const data = useData()
  return (
    <section id="dash-chrome">
      dash:{data.boom}
      {children}
    </section>
  )
}
