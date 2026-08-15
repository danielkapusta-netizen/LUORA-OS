import { motion } from 'framer-motion'
import { useId } from 'react'

import { springSnappy } from '@/lib/motion'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/**
 * Segmented control with a shared layout indicator — the selection slides
 * between options rather than blinking, which keeps the eye anchored.
 *
 * The slide is a spring, so a run of quick changes stays continuous: each new
 * choice re-targets the motion already in flight instead of restarting it, and
 * the indicator never snaps back to re-travel ground it has already covered.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  'aria-label'?: string
}) {
  const layoutId = useId()

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-control border border-hairline bg-surface-sunken p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              'press-sm relative rounded-[7px] px-3 py-1.5',
              't-small font-medium transition-colors duration-150',
              isActive ? 'text-ink' : 'text-ink-subtle hover:text-ink-muted',
            )}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-[7px] bg-surface shadow-card"
                transition={springSnappy}
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
