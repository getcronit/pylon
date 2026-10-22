import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {rgbaToThumbHash} from 'thumbhash'
import {describe, expect, it} from 'vitest'
import {Image} from '@/pages/pages/image'

// A real hash for a 2x2 image, so the decode is exercised rather than mocked.
const rgba = new Uint8Array([
  200, 40, 60, 255, 200, 40, 60, 255, 190, 35, 55, 255, 190, 35, 55, 255
])
const HASH = Buffer.from(rgbaToThumbHash(2, 2, rgba)).toString('base64')

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(Image, {src: '/a.png', alt: '', ...props} as any))

describe('Image with a thumbHash', () => {
  it('paints a background colour instead of fetching a placeholder', () => {
    const html = render({thumbHash: HASH})
    expect(html).toMatch(/background-color:\s*rgb\(/)
    // The whole point: no request for a placeholder.
    expect(html).not.toContain('lqip=true')
  })

  it('preloads nothing for it', () => {
    const html = render({thumbHash: HASH})
    expect(html).not.toMatch(/rel="preload"[^>]*lqip/)
  })

  it('falls back to the generated placeholder without a hash', () => {
    const html = render({})
    expect(html).toContain('lqip=true')
    expect(html).not.toMatch(/background-color:\s*rgb\(/)
  })

  it('an unusable hash degrades to the generated placeholder, not a crash', () => {
    const html = render({thumbHash: 'not-base64-at-all!!'})
    expect(html).toContain('lqip=true')
  })

  it('an explicit blurDataURL still wins', () => {
    const html = render({blurDataURL: 'data:image/gif;base64,AAAA'})
    expect(html).toContain('data:image/gif;base64,AAAA')
    expect(html).not.toContain('lqip=true')
  })
})
