import { animate, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Counts a figure up on first paint and eases between values on refresh.
 *
 * The animation exists to draw the eye to what changed, not to entertain — it
 * settles in under a second and is disabled outright for users who ask for
 * reduced motion.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  duration = 0.85,
}: {
  value: number
  format: (value: number) => string
  className?: string
  duration?: number
}) {
  const prefersReducedMotion = useReducedMotion()
  const previous = useRef(0)
  const [display, setDisplay] = useState(prefersReducedMotion ? value : 0)

  useEffect(() => {
    if (prefersReducedMotion) {
      previous.current = value
      setDisplay(value)
      return
    }

    const controls = animate(previous.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplay(latest),
      onComplete: () => {
        previous.current = value
      },
    })

    return () => controls.stop()
  }, [value, duration, prefersReducedMotion])

  return <span className={cn('tnum', className)}>{format(display)}</span>
}
