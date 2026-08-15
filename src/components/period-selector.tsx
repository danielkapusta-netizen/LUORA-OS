import { AnimatePresence, motion } from 'framer-motion'
import { Calendar, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { PERIOD_OPTIONS, type PeriodKey } from '@/domain/period'
import { materialize } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The Business Snapshot selector — the single control that scopes the whole
 * application. Presented as a menu rather than a segmented control because it
 * carries a custom-range option and needs room to breathe in a page header.
 *
 * The menu grows out of the button that opened it and collapses back into it,
 * so the surface is visibly anchored to its source rather than arriving from
 * nowhere.
 */
export function PeriodSelector({
  value,
  label,
  onChange,
  onCustom,
}: {
  value: PeriodKey
  label: string
  onChange: (key: PeriodKey) => void
  onCustom: (from: Date, to: Date) => void
}) {
  const [isOpen, setOpen] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setShowCustom(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setShowCustom(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const applyCustom = () => {
    if (!from || !to) return
    const fromDate = new Date(`${from}T00:00:00Z`)
    const toDate = new Date(`${to}T00:00:00Z`)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return
    onCustom(fromDate, toDate)
    setOpen(false)
    setShowCustom(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="secondary"
        onClick={() => setOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <Calendar className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
        {label}
        <ChevronDown
          className={cn('h-3.5 w-3.5 text-ink-subtle transition-transform', isOpen && 'rotate-180')}
          aria-hidden="true"
        />
      </Button>

      <AnimatePresence>
        {isOpen && (
        <motion.div
          role="menu"
          initial={materialize.initial}
          animate={materialize.animate}
          exit={materialize.exit}
          transition={materialize.transition}
          style={{ transformOrigin: 'top right' }}
          className="material-thin absolute right-0 z-50 mt-2 w-60 rounded-xl border border-hairline p-1.5 shadow-overlay"
        >
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              role="menuitemradio"
              aria-checked={value === option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={cn(
                'press-sm flex w-full items-center justify-between rounded-lg px-3 py-2 text-left',
                't-small vibrant transition-colors duration-150',
                value === option.value
                  ? 'bg-surface-sunken font-semibold text-ink'
                  : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
              )}
            >
              {option.label}
              {value === option.value && <span className="text-accent">•</span>}
            </button>
          ))}

          <div className="my-1.5 h-px bg-hairline" />

          {!showCustom ? (
            <button
              type="button"
              onClick={() => setShowCustom(true)}
              className={cn(
                'press-sm flex w-full items-center rounded-lg px-3 py-2 text-left',
                't-small vibrant transition-colors duration-150',
                value === 'custom'
                  ? 'bg-surface-sunken font-semibold text-ink'
                  : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
              )}
            >
              Custom range…
            </button>
          ) : (
            <div className="space-y-2 p-2">
              <label className="t-micro block font-medium text-ink-subtle">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="mt-1 h-8 w-full rounded-control border border-hairline bg-surface px-2 t-small text-ink"
                />
              </label>
              <label className="t-micro block font-medium text-ink-subtle">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  className="mt-1 h-8 w-full rounded-control border border-hairline bg-surface px-2 t-small text-ink"
                />
              </label>
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={applyCustom}
                disabled={!from || !to}
              >
                Apply range
              </Button>
            </div>
          )}
        </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
