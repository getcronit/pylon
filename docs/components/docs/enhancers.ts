import {useEffect} from 'react'

/**
 * Client-side enhancers for the rendered markdown (which is injected as HTML,
 * so it isn't managed by React):
 *  - copy-to-clipboard buttons on code blocks
 *  - scroll-spy that highlights the active heading in the table of contents
 *
 * Pass the current slug so the effect re-runs on client-side navigation.
 */
export function useDocsEnhancers(slug: string) {
  useEffect(() => {
    // --- copy buttons ---
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement
      const btn = target.closest('.code-copy') as HTMLElement | null
      if (!btn) return
      const pre = btn.parentElement?.querySelector('pre')
      const text = pre instanceof HTMLElement ? pre.innerText : ''
      navigator.clipboard?.writeText(text).then(() => {
        btn.classList.add('copied')
        window.setTimeout(() => btn.classList.remove('copied'), 1400)
      })
    }
    document.addEventListener('click', onClick)

    // --- scroll-spy ---
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>('.prose h2[id], .prose h3[id], .prose h4[id]')
    )
    const links = new Map<string, HTMLAnchorElement>()
    document.querySelectorAll<HTMLAnchorElement>('[data-toc] a').forEach(a => {
      const id = a.getAttribute('href')?.slice(1)
      if (id) links.set(id, a)
    })

    let frame = 0
    const setActive = () => {
      frame = 0
      if (!headings.length) return
      let current = headings[0].id
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 104) current = h.id
        else break
      }
      links.forEach((a, id) => a.classList.toggle('toc-active', id === current))
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(setActive)
    }

    setActive()
    window.addEventListener('scroll', onScroll, {passive: true})

    return () => {
      document.removeEventListener('click', onClick)
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [slug])
}
