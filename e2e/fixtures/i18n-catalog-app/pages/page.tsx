import {useFormatter, useTranslations} from '@getcronit/pylon/pages'

const Page: React.FC = () => {
  const t = useTranslations()
  const c = useTranslations('checkout')
  const {number} = useFormatter()
  return (
    <main>
      <p id="home">{t('nav.home')}</p>
      <p id="total">{c('total', {amount: number(12.5, {style: 'currency', currency: 'EUR'}), count: 3})}</p>
      <p id="empty">{c('empty')}</p>
      <p id="one">{c('items', {count: 1})}</p>
      <p id="many">{c('items', {count: 7})}</p>
    </main>
  )
}
export default Page
