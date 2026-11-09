import {cn} from '@/lib/utils'

/**
 * Pylon logo — the brand mark: a "gateway" (two tapered towers + a lintel forming a doorway),
 * the architectural pylon the name comes from, in the signature cyan→violet gradient and paired
 * with the wordmark. It's literal to the name, reads as a gateway to your API, and stays crisp
 * at any size — vector, so it themes cleanly unlike the raster `public/logo.png`.
 */
export function Logo({className, withText = true}: {className?: string; withText?: boolean}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        width="26"
        height="26"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0">
        <defs>
          <linearGradient id="pylon-logo" x1="16" y1="4" x2="16" y2="29" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38f6fc" />
            <stop offset="1" stopColor="#7c6bff" />
          </linearGradient>
        </defs>
        {/* left tower */}
        <path d="M6 27 L11 27 L11 11 L8 11 Z" fill="url(#pylon-logo)" />
        {/* right tower */}
        <path d="M21 27 L26 27 L24 11 L21 11 Z" fill="url(#pylon-logo)" />
        {/* lintel across the top → the doorway between the towers */}
        <path d="M6 6 L26 6 L24 11 L8 11 Z" fill="url(#pylon-logo)" />
      </svg>
      {withText && (
        <span className="text-[17px] font-semibold tracking-tight text-fg">Pylon</span>
      )}
    </span>
  )
}
