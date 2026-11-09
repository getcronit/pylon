import {cn} from '@/lib/utils'

/**
 * A code "window" with chrome and a filename tab. Children are the code body
 * (pre-formatted JSX, optionally with token spans). Presentational only.
 */
export function CodePanel({
  filename,
  accent,
  className,
  children
}: {
  filename: string
  accent?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-[#0c0e10] shadow-2xl',
        accent ? 'border-accent/30 glow-accent' : 'border-border',
        className
      )}>
      <div className="flex items-center gap-2 border-b border-border/80 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-2 font-mono text-xs text-fg-subtle">{filename}</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  )
}

/** Token helpers for hand-highlighted snippets. */
export const Tok = {
  k: (c: React.ReactNode) => <span className="text-[#ff7b72]">{c}</span>, // keyword
  s: (c: React.ReactNode) => <span className="text-[#a5d6ff]">{c}</span>, // string
  f: (c: React.ReactNode) => <span className="text-[#d2a8ff]">{c}</span>, // function / type
  t: (c: React.ReactNode) => <span className="text-[#7ee787]">{c}</span>, // type name
  c: (c: React.ReactNode) => <span className="text-fg-subtle">{c}</span>, // comment
  p: (c: React.ReactNode) => <span className="text-[#79c0ff]">{c}</span> // property / number
}
