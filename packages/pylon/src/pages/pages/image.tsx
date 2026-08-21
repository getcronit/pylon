import React, {useMemo} from 'react'

interface ImageValuesProps {
  src: string | PylonBuildSrc
  alt?: string
  className?: string
  width?: number
  height?: number
  blurDataURL?: string
  /**
   * How wide the image renders, as a CSS `sizes` list — e.g.
   * `'(max-width: 768px) 100vw, 50vw'`.
   *
   * This is what makes `srcset` work. Without it the browser must assume the
   * image fills the viewport and picks the largest candidate, which is the
   * opposite of the point. A `fill` image with no `sizes` defaults to
   * `100vw`, which is usually true and always safe.
   */
  sizes?: string
}

export interface ImageProps extends Omit<ImageValuesProps, 'src'> {
  src: string
  fill?: boolean
  style?: React.CSSProperties
  /**
   * Load this image eagerly, at high priority, and preload it.
   *
   * Images are lazy by default, which is right for almost all of them — but
   * wrong for the one that IS the Largest Contentful Paint. A lazy hero is
   * discovered only after layout, so the browser starts fetching it late and
   * LCP moves out by exactly that delay. Set this on the hero and on nothing
   * else: marking everything priority is the same as marking nothing.
   */
  priority?: boolean
  /**
   * Override the loading strategy. Defaults to `'lazy'`; `priority` forces
   * `'eager'` regardless.
   *
   * Separate from `priority` because the two answer different questions.
   * `priority` says "this is the LCP" and preloads it — right for one image
   * per page. `loading="eager"` just says "do not defer this", which is what
   * you need for images the lazy heuristic gets wrong: anything inside a
   * carousel or marquee that is moved into view by a transform rather than by
   * scrolling, where the browser may never decide it became visible.
   */
  loading?: 'lazy' | 'eager'
}

/**
 * Candidate widths for `srcset`.
 *
 * The small end covers icons and thumbnails, the large end common device
 * widths at 1x and 2x. The proxy clamps anything wider than the source, so an
 * oversized candidate costs nothing — it resolves to the original width.
 */
const WIDTH_LADDER = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048,
  3840
]

/** Widths worth offering when the image spans a share of the viewport. */
const VIEWPORT_WIDTHS = [640, 750, 828, 1080, 1200, 1920, 2048, 3840]

interface PylonBuildSrc {
  url: string
  width?: number
  height?: number
  blurDataURL?: string
}

/**
 * Custom hook to process and extract image properties,
 * ensuring correct values for width, height, and blur data.
 * Generates a final image URL compatible with Pylon's media proxy.
 *
 * @param {ImageProps} props - The image properties including src, width, height, and blurDataURL.
 * @returns {Object} The processed image values: width, height, blurDataURL, and final image source.
 */
const usePylonImageValues = (
  props: ImageValuesProps
): {
  src: string
  width?: number
  height?: number
  blurDataURL?: string
  srcSet?: string
  sizes?: string
  preloads: string[]
} => {
  return useMemo(() => {
    // // Parse the image source URL to extract query parameters
    // const isSrcAbsolute =
    //   props.src.startsWith('http://') || props.src.startsWith('https://')
    // const url = new URL(props.src, 'http://localhost')
    // const searchParams = new URLSearchParams(url.search)

    // // Extract values, prioritizing props over query params
    // const getValue = (propValue, paramKey) =>
    //   propValue ?? searchParams.get(paramKey)
    // const width = getValue(props.width, 'w')
    // const height = getValue(props.height, 'h')
    // const blurDataURL = getValue(props.blurDataURL, 'blurDataURL')

    // // Prepare Pylon-specific query params
    // const pylonMediaSearchParams = new URLSearchParams({
    //   src:
    //   ...(width && {w: width.toString()}),
    //   ...(height && {h: height.toString()})
    // })

    const pylonMediaSearchParams = new URLSearchParams({})
    let blurDataURL: string | undefined

    if (typeof props.src === 'string') {
      pylonMediaSearchParams.set('src', props.src)
    } else {
      pylonMediaSearchParams.set('src', props.src.url)

      if (props.src.width) {
        pylonMediaSearchParams.set('w', props.src.width.toString())
      }

      if (props.src.height) {
        pylonMediaSearchParams.set('h', props.src.height.toString())
      }

      blurDataURL = props.src.blurDataURL
    }

    if (props.width) {
      pylonMediaSearchParams.set('w', props.width.toString())
    }

    if (props.height) {
      pylonMediaSearchParams.set('h', props.height.toString())
    }

    if (props.blurDataURL) {
      blurDataURL = props.blurDataURL
    }

    // Construct the final image source URL
    const finalSrc = `/__pylon/image?${pylonMediaSearchParams.toString()}`

    const width = pylonMediaSearchParams.has('w')
      ? parseInt(pylonMediaSearchParams.get('w')!)
      : undefined
    const height = pylonMediaSearchParams.has('h')
      ? parseInt(pylonMediaSearchParams.get('h')!)
      : undefined

    const preloads: string[] = []

    if (!blurDataURL) {
      // Use finalSrc with lqip=true to generate blurDataURL
      blurDataURL = finalSrc + '&lqip=true'

      // Preload the blurDataURL image
      preloads.push(blurDataURL)
    }

    // One candidate URL, differing only in width. `h` is dropped: the proxy
    // derives it from the source's aspect ratio, so every candidate stays in
    // proportion instead of being squeezed to one fixed height.
    const at = (w: number) => {
      const p = new URLSearchParams(pylonMediaSearchParams)
      p.set('w', String(w))
      p.delete('h')
      return `/__pylon/image?${p.toString()}`
    }

    let srcSet: string | undefined
    let sizes = props.sizes

    if (sizes) {
      // The caller said how wide it renders, so offer the full ladder and let
      // the browser choose against `sizes`.
      srcSet = WIDTH_LADDER.map(w => `${at(w)} ${w}w`).join(', ')
    } else if (width) {
      // A fixed-size image. Density descriptors, not widths — with no `sizes`
      // a `w` descriptor would make the browser assume full-viewport and pull
      // the largest file for a small slot.
      srcSet = `${at(width)} 1x, ${at(width * 2)} 2x`
    } else {
      // No width and no `sizes`: the image is being stretched to its
      // container. Assume the viewport, which is what `fill` usually means.
      sizes = '100vw'
      srcSet = VIEWPORT_WIDTHS.map(w => `${at(w)} ${w}w`).join(', ')
    }

    return {
      width,
      height,
      blurDataURL,
      src: finalSrc,
      srcSet,
      sizes,
      preloads
    }
  }, [props])
}

export const Image: React.FC<ImageProps> = props => {
  const values = usePylonImageValues(props)

  return (
    <>
      {props.priority && (
        <link
          rel="preload"
          as="image"
          href={values.src}
          imageSrcSet={values.srcSet}
          imageSizes={values.sizes}
          fetchPriority="high"
        />
      )}
      {values.preloads.map((src, index) => (
        <link key={index} rel="preload" as="image" href={src} />
      ))}
      <img
        src={values.src}
        srcSet={values.srcSet}
        sizes={values.sizes}
        alt={props.alt}
        className={props.className}
        width={values.width}
        height={values.height}
        style={{
          // QUOTED on purpose. React server-renders this value verbatim, while
          // the browser's CSSOM re-serializes `url(…)` as `url("…")` — so an
          // unquoted URL is one string in the HTML and another in the DOM, and
          // hydration reports a style mismatch on every Image. Emitting the
          // quotes ourselves makes both sides agree.
          backgroundImage: `url("${values.blurDataURL}")`,
          backgroundSize: 'cover',
          height: props.fill ? '100%' : undefined,
          width: props.fill ? '100%' : undefined,
          ...props.style
        }}
        loading={props.priority ? 'eager' : (props.loading ?? 'lazy')}
        fetchPriority={props.priority ? 'high' : undefined}
      />
    </>
  )
}
