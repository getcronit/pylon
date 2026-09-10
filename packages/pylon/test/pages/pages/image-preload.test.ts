import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it} from 'vitest'
import {Image} from '@/pages/pages/image'

// The LQIP placeholder used to be preloaded for EVERY image. React hoists those
// links into <head>, so a page put each of its pictures — lazy ones far below
// the fold included — at the front of the network queue, competing with the CSS
// and fonts the first paint waits on. A storefront home page emitted 39 of them,
// 16 of which were duplicates, for decorative logos nobody had scrolled to.
//
// `createElement` rather than JSX: the suite only picks up `.ts` files.
const preloads = (html: string) =>
  (html.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/g) ?? []).length

describe('Image preloads', () => {
  it('a lazy image preloads nothing', () => {
    const html = renderToStaticMarkup(
      React.createElement(Image, {src: '/a.png', alt: ''})
    )
    expect(preloads(html)).toBe(0)
    // The placeholder itself is unaffected — it is a CSS background, not a fetch.
    expect(html).toContain('lqip=true')
  })

  it('a priority image still preloads', () => {
    const html = renderToStaticMarkup(
      React.createElement(Image, {src: '/a.png', alt: '', priority: true})
    )
    expect(preloads(html)).toBeGreaterThan(0)
  })

  it('sixteen lazy images add nothing to the head', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        ...Array.from({length: 16}, (_, i) =>
          React.createElement(Image, {key: i, src: `/logo-${i}.png`, alt: ''})
        )
      )
    )
    expect(preloads(html)).toBe(0)
  })
})
