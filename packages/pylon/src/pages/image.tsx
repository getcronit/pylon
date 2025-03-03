import React, {useState, useEffect, useMemo, useRef} from 'react'

export interface ImageProps {
  src: string
  alt?: string
  className?: string
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
  props: ImageProps
): {
  src: string
  width?: number
  height?: number
  blurDataURL?: string
} => {
  return useMemo(() => {
    // Parse the image source URL to extract query parameters
    const url = new URL(props.src, 'http://localhost')
    const searchParams = new URLSearchParams(url.search)

    // Extract values, prioritizing props over query params
    const getValue = (propValue, paramKey) =>
      propValue ?? searchParams.get(paramKey)
    const width = getValue(props.width, 'w')
    const height = getValue(props.height, 'h')
    const blurDataURL = getValue(props.blurDataURL, 'blurDataURL')

    // Prepare Pylon-specific query params
    const pylonMediaSearchParams = new URLSearchParams({
      src: url.pathname,
      ...(width && {w: width.toString()}),
      ...(height && {h: height.toString()})
    })

    // Construct the final image source URL
    const finalSrc = `/__pylon/image?${pylonMediaSearchParams.toString()}`

    return {
      width: width ? parseInt(width) : undefined,
      height: height ? parseInt(height) : undefined,
      blurDataURL,
      src: finalSrc
    }
  }, [props])
}

export const PylonImage: React.FC<ImageProps> = props => {
  console.log('PylonImage', props)

  const values = usePylonImageValues(props)
  const [isLoaded, setIsLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  console.log('mgRef.current?.complete', imgRef.current?.complete)

  useEffect(() => {
    if (imgRef.current?.complete) {
      setIsLoaded(true)
    }
  }, [imgRef.current])

  return (
    <img
      ref={imgRef}
      src={values.src}
      alt={props.alt}
      className={props.className}
      width={values.width}
      height={values.height}
      onLoad={() => setIsLoaded(true)}
      style={{
        backgroundImage: `url(${values.blurDataURL})`,
        backgroundSize: 'cover',
        filter: !isLoaded ? 'blur(5px)' : 'none',
        transition: 'filter 0.3s ease-out, opacity 0.3s ease-out'
      }}
      loading="lazy"
    />
  )
}
