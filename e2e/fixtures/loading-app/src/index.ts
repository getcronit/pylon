import {Pylon} from '@getcronit/pylon'

// `ok` always resolves. Every page reads it via `useData`, which suspends on first read
// and resolves in-process during SSR — so each page exercises a Suspense-shaped read even
// though the resolver is fast. That is what lets the serve test prove the `loading.tsx`
// fallback never lands in the buffered SSR HTML (the boundary is client-only in Phase 1).
export default new Pylon({
  graphql: {
    Query: {
      ok: (): string => 'ok'
    },
    Mutation: {}
  }
})
