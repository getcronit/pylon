import type {PageProps} from '@getcronit/pylon/pages'

const Page: React.FC<PageProps> = ({context}) => {
  const {theme, sidebarOpen, locale} = context as {
    theme: string
    sidebarOpen: boolean
    locale: string
  }
  return (
    <main>
      <p id="theme">{theme}</p>
      <p id="locale">{locale}</p>
      <aside id="sidebar" data-state={sidebarOpen ? 'open' : 'closed'} />
    </main>
  )
}
export default Page
