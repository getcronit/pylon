import type {SameShape} from '@getcronit/pylon/pages'
import type en from './en'

// `satisfies` makes a missing or typo'd key a compile error — no build step involved.
export default {
  nav: {home: 'Startseite'},
  checkout: {
    total: 'Gesamt: {amount} für {count} Artikel',
    empty: 'Ihr Warenkorb ist leer'
  }
} satisfies SameShape<typeof en>
