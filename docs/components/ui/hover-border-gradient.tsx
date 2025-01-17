'use client'
import React, {useState, useEffect} from 'react'
import {motion} from 'framer-motion'
import {useTheme} from 'nextra-theme-docs'

import {cn} from '@/lib/utils'

type Direction = 'TOP' | 'LEFT' | 'BOTTOM' | 'RIGHT'

export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  as: Tag = 'button',
  duration = 1,
  clockwise = true,
  ...props
}: React.PropsWithChildren<
  {
    as?: React.ElementType
    containerClassName?: string
    className?: string
    duration?: number
    clockwise?: boolean
  } & React.HTMLAttributes<HTMLElement>
>) {
  const [hovered, setHovered] = useState<boolean>(false)
  const [direction, setDirection] = useState<Direction>('TOP')

  const {resolvedTheme} = useTheme()

  // Usually, we wouldnt need this, but the useTheme hook from nextra-theme-docs seem to have (a) bug(s)
  const theme =
    resolvedTheme && resolvedTheme === 'system'
      ? 'dark'
      : resolvedTheme ?? 'dark'

  const rotateDirection = (currentDirection: Direction): Direction => {
    const directions: Direction[] = ['TOP', 'LEFT', 'BOTTOM', 'RIGHT']
    const currentIndex = directions.indexOf(currentDirection)
    const nextIndex = clockwise
      ? (currentIndex - 1 + directions.length) % directions.length
      : (currentIndex + 1) % directions.length
    return directions[nextIndex]
  }

  const movingMap: Record<'dark' | 'light', Record<Direction, string>> = {
    dark: {
      TOP: 'radial-gradient(20.7% 50% at 50% 0%, #3275F8 0%, rgba(255, 255, 255, 0) 100%)',
      LEFT: 'radial-gradient(16.6% 43.1% at 0% 50%, #3275F8 0%, rgba(255, 255, 255, 0) 100%)',
      BOTTOM:
        'radial-gradient(20.7% 50% at 50% 100%, #3275F8 0%, rgba(255, 255, 255, 0) 100%)',
      RIGHT:
        'radial-gradient(16.2% 41.199999999999996% at 100% 50%, #3275F8 0%, rgba(255, 255, 255, 0) 100%)'
    },
    light: {
      TOP: 'radial-gradient(20.7% 50% at 50% 0%, #3275F8 0%, rgba(255, 255, 255, 1) 100%)',
      LEFT: 'radial-gradient(16.6% 43.1% at 0% 50%, #3275F8 0%, rgba(255, 255, 255, 1) 100%)',
      BOTTOM:
        'radial-gradient(20.7% 50% at 50% 100%, #3275F8 0%, rgba(255, 255, 255, 1) 100%)',
      RIGHT:
        'radial-gradient(16.2% 41.199999999999996% at 100% 50%, #3275F8 0%, rgba(255, 255, 255, 1) 100%)'
    }
  }

  const highlight =
    theme === 'dark'
      ? 'radial-gradient(75% 181.15942028985506% at 50% 50%, #3275F8 0%, rgba(255, 255, 255, 0) 100%)'
      : 'radial-gradient(75% 181.15942028985506% at 50% 50%, #3275F8 0%, rgba(255, 255, 255, 1) 100%)'

  useEffect(() => {
    if (!hovered) {
      const interval = setInterval(() => {
        setDirection(prevState => rotateDirection(prevState))
      }, duration * 1000)
      return () => clearInterval(interval)
    }
  }, [hovered])
  return (
    <Tag
      onMouseEnter={(event: React.MouseEvent<HTMLDivElement>) => {
        setHovered(true)
      }}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'relative flex rounded-full border  content-center bg-border dark:hover:bg-white/10 transition duration-500 dark:bg-white/20 items-center flex-col flex-nowrap gap-10 h-min justify-center overflow-visible p-px decoration-clone w-fit',
        containerClassName
      )}
      {...props}>
      <div
        className={cn(
          'w-auto text-primary z-10 bg-white dark:bg-[#0a0a0a] px-4 py-2 rounded-[inherit]',
          className
        )}>
        {children}
      </div>
      <motion.div
        className={cn(
          'flex-none inset-0 overflow-hidden absolute z-0 rounded-[inherit]'
        )}
        style={{
          filter: 'blur(2px)',
          position: 'absolute',
          width: '100%',
          height: '100%'
        }}
        initial={{background: movingMap[direction]}}
        animate={{
          background: hovered
            ? [movingMap[theme][direction], highlight]
            : movingMap[theme][direction]
        }}
        transition={{ease: 'linear', duration: duration ?? 1}}
      />
      <div className="bg-black absolute z-1 flex-none inset-[2px] rounded-[100px]" />
    </Tag>
  )
}