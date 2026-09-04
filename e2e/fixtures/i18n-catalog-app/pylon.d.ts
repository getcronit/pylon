import '@getcronit/pylon'

declare module '@getcronit/pylon/pages' {
  // Registers the DEFAULT locale as the type source: keys and placeholders both come
  // from these literals.
  interface Register {
    messages: (typeof import('./messages/en'))['default']
  }
}
