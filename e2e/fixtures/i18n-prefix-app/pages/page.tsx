import {Link, useLocale} from '@getcronit/pylon/pages'

const home: Record<string, string> = {en: 'Home', de: 'Startseite', fr: 'Accueil'}

const Page: React.FC = () => {
  const {locale, basename, suggestedLocale} = useLocale() as any
  return (
    <main>
      <p id="page">home</p>
      <p id="locale">{locale}</p>
      <p id="copy">{home[locale]}</p>
      <p id="basename">{basename || '(root)'}</p>
      <p id="suggested">{suggestedLocale ?? '(none)'}</p>
      {/* Plain Link: basename makes this locale-preserving on its own. */}
      <Link id="to-pricing" href="/pricing">pricing</Link>
      {/* Language switcher: same page, other locale. */}
      <Link id="switch-de" locale="de">Deutsch</Link>
      <Link id="switch-en" locale="en">English</Link>
      {/* Cross-locale to a SPECIFIC page. */}
      <Link id="switch-fr-pricing" href="/pricing" locale="fr">Tarifs</Link>
    </main>
  )
}
export default Page
