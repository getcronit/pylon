import {useData, useFormatter, useTranslations} from '@getcronit/pylon/pages'

const Page: React.FC = () => {
  const t = useTranslations()
  const c = useTranslations('checkout')
  const {number} = useFormatter()
  const data = useData()
  return (
    <main>
      <p id="home">{t('nav.home')}</p>
      <p id="total">{c('total', {amount: number(12.5, {style: 'currency', currency: 'EUR'}), count: 3})}</p>
      <p id="empty">{c('empty')}</p>
      <p id="server">{data.serverGreeting}</p>
      {/* Not used by the automated tests — the e2e suite has no browser. It exists so the
          client-initiated fetch path stays reproducible by hand: load /de, patch
          window.fetch, click this, and inspect the body for `__locale`. That is how the dev
          client was found to be sending a directive-less document. */}
      <button id="refetch-btn" onClick={() => data.$refetch(true)}>refetch</button>
      <p id="one">{c('items', {count: 1})}</p>
      <p id="many">{c('items', {count: 7})}</p>
    </main>
  )
}
export default Page
