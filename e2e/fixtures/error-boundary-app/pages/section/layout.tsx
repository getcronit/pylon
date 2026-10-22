// This layout does NOT read failing data, so it renders fine — its chrome must survive
// when a nested route fails.
export default function SectionLayout({children}: {children: React.ReactNode}) {
  return <section id="section-chrome">{children}</section>
}
