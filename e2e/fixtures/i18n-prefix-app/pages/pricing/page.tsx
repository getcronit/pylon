import {useLocale} from '@getcronit/pylon/pages'

const title: Record<string, string> = {en: 'Pricing', de: 'Preise', fr: 'Tarifs'}

const Page: React.FC = () => {
  const {locale} = useLocale()
  return (
    <main>
      <p id="page">pricing</p>
      <p id="locale">{locale}</p>
      <p id="copy">{title[locale]}</p>
    </main>
  )
}
export default Page
