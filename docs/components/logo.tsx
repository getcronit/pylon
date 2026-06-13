import {cn} from '@/lib/utils'

/**
 * Pylon wordmark — an abstract "gateway" mark (two pylons + a lintel) in the
 * signature cyan, paired with the wordmark.
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
          <linearGradient id="pylon-mark" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38f6fc" />
            <stop offset="1" stopColor="#8b7bff" />
          </linearGradient>
        </defs>
        {/* lintel */}
        <rect x="4" y="4" width="24" height="5" rx="2" fill="url(#pylon-mark)" />
        {/* left pylon */}
        <rect x="6" y="11" width="6" height="17" rx="2" fill="url(#pylon-mark)" />
        {/* right pylon */}
        <rect x="20" y="11" width="6" height="17" rx="2" fill="url(#pylon-mark)" />
        {/* center spark */}
        <rect x="14" y="14" width="4" height="4" rx="1" fill="#fff" opacity="0.9" />
      </svg>
      {withText && (
        <span className="text-[17px] font-semibold tracking-tight text-fg">Pylon</span>
      )}
    </span>
  )
}
