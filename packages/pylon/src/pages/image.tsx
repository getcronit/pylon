import React, {useMemo} from 'react'

interface ImageValuesProps {
  src: string | PylonBuildSrc
  alt?: string
  className?: string
  width?: number
  height?: number
  blurDataURL?: string
}

export interface ImageProps extends Omit<ImageValuesProps, 'src'> {
  src: string
  fill?: boolean
}

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

    return {
      width,
      height,
      blurDataURL,
      src: finalSrc
    }
  }, [props])
}

export const Image: React.FC<ImageProps> = props => {
  const values = usePylonImageValues(props)

  return (
    <img
      src={values.src}
      alt={props.alt}
      className={props.className}
      width={values.width ?? props.fill ? '100%' : undefined}
      height={values.height ?? props.fill ? '100%' : undefined}
      style={{
        backgroundImage: `url(${values.blurDataURL})`,
        backgroundSize: 'cover'
      }}
      loading="lazy"
    />
  )
}
