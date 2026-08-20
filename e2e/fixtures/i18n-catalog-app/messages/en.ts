// The DEFAULT locale is the type source: `as const` keeps the message literals, which is
// what makes both keys and placeholders inferable.
export default {
  nav: {home: 'Home'},
  checkout: {
    total: 'Total: {amount} for {count} items',
    empty: 'Your cart is empty'
  }
} as const
