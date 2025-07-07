import '@getcronit/pylon'

declare module '@getcronit/pylon' {
  interface Bindings {
    DB: D1Database
  }

  interface Variables {}
}
