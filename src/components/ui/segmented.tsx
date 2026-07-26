import { motion } from 'framer-motion'
import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/**
 * Segmented control with a shared layout indicator — the selection slides
 * between options rather than blinking, which keeps the eye anchored.
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
              'relative rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors duration-150',
              isActive ? 'text-ink' : 'text-ink-subtle hover:text-ink-muted',
            )}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-[7px] bg-surface shadow-card"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
