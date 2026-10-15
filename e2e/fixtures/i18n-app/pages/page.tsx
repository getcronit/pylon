import {useLocale} from '@getcronit/pylon/pages'

const messages: Record<string, string> = {en: 'Hello', de: 'Hallo', fr: 'Bonjour'}

const Page: React.FC = () => {
  const {locale, localeWasExplicit, defaultLocale} = useLocale()
  return (
    <main>
      <p id="greeting">{messages[locale]}</p>
      <p id="locale">{locale}</p>
      <p id="explicit">{String(localeWasExplicit)}</p>
      <p id="default">{defaultLocale}</p>
    </main>
  )
}
export default Page
