'use client'

import React, {useEffect, useRef, useState} from 'react'
import {AnimatePresence, motion} from 'framer-motion'
import {cn} from '@/lib/utils'

export const GlowingStarsCard = ({
  className,
  children
}: {
  className?: string
  children?: React.ReactNode
}) => {
  const [mouseEnter, setMouseEnter] = useState(false)

  return (
    <div
      onMouseEnter={() => {
        setMouseEnter(true)
      }}
      onMouseLeave={() => {
        setMouseEnter(false)
      }}
      className={cn(
        'p-6 max-w-md h-full w-full rounded-xl border border-[#eaeaea] dark:border-gray-800',
        className
      )}>
      <div className="flex justify-center items-center">
        <Illustration mouseEnter={mouseEnter} />
      </div>
      <div className="px-2 pb-6">{children}</div>
    </div>
  )
}

export const GlowingStarsDescription = ({
  className,
  children
}: {
  className?: string
  children?: React.ReactNode
}) => {
  return (
    <p className={cn('text-base text-white max-w-[16rem]', className)}>
      {children}
    </p>
  )
}

export const GlowingStarsTitle = ({
  className,
  children
}: {
  className?: string
  children?: React.ReactNode
}) => {
  return (
    <h2 className={cn('font-bold text-2xl text-[#eaeaea]', className)}>
      {children}
    </h2>
  )
}

export const Illustration = ({mouseEnter}: {mouseEnter: boolean}) => {
  const stars = 108
  const columns = 18

  const [glowingStars, setGlowingStars] = useState<number[]>([])

  const highlightedStars = useRef<number[]>([])

  useEffect(() => {
    const interval = setInterval(() => {
      highlightedStars.current = Array.from({length: 5}, () =>
        Math.floor(Math.random() * stars)
      )
      setGlowingStars([...highlightedStars.current])
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div
      className="h-[180px] p-1 w-full"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: `1px`
      }}>
      {[...Array(stars)].map((_, starIdx) => {
        const isGlowing = glowingStars.includes(starIdx)
        const delay = (starIdx % 10) * 0.1
        const staticDelay = starIdx * 0.01
        return (
          <div
            key={`matrix-col-${starIdx}}`}
            className="relative flex items-center justify-center">
            <Star
              isGlowing={mouseEnter ? true : isGlowing}
              delay={mouseEnter ? staticDelay : delay}
            />
            {mouseEnter && <Glow delay={staticDelay} />}
            <AnimatePresence mode="wait">
              {isGlowing && <Glow delay={delay} />}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

const Star = ({isGlowing, delay}: {isGlowing: boolean; delay: number}) => {
  return (
    <motion.div
      key={delay}
      initial={{
        scale: 1
      }}
      animate={{
        scale: isGlowing ? [1, 1.2, 2.5, 2.2, 1.5] : 1,
        background: isGlowing ? '#fff' : '#666'
      }}
      transition={{
        duration: 2,
        ease: 'easeInOut',
        delay: delay
      }}
      className={cn(
        'bg-[#666] h-[1px] w-[1px] rounded-full relative z-20'
      )}></motion.div>
  )
}

const Glow = ({delay}: {delay: number}) => {
  return (
    <motion.div
      initial={{
        opacity: 0
      }}
      animate={{
        opacity: 1
      }}
      transition={{
        duration: 2,
        ease: 'easeInOut',
        delay: delay
      }}
      exit={{
        opacity: 0
      }}
      className="absolute  left-1/2 -translate-x-1/2 z-10 h-[4px] w-[4px] rounded-full bg-blue-500 blur-[1px] shadow-2xl shadow-blue-400"
    />
  )
}
