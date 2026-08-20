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
      <p id="missing">{t('nav.home')}</p>
    </main>
  )
}
export default Page
