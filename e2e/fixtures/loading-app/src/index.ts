import {Pylon} from '@getcronit/pylon'

// `ok` always resolves. Every page reads it via `useData`, which suspends on first read
// and resolves in-process during SSR — so each page exercises a Suspense-shaped read even
// though the resolver is fast. That is what lets the serve test prove the `loading.tsx`
// fallback never lands in the buffered SSR HTML (the boundary is client-only in Phase 1).
export default new Pylon({
  graphql: {
    Query: {
      ok: (): string => 'ok',
      // Deliberately async with a small delay so a `loading.tsx` boundary reading it reliably
      // SUSPENDS during SSR — the streaming path then flushes the fallback in the shell and
      // streams the resolved value in behind it.
      slow: async (): Promise<string> => {
        await new Promise(r => setTimeout(r, 40))
        return 'slow-ok'
      }
    },
    Mutation: {}
  }
})
