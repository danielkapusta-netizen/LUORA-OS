import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * Every page opens the same way: what this page is, then one line of orienting
 * context, then any controls. Consistency here is what makes the product feel
 * like one system rather than a collection of screens.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="max-w-2xl space-y-2">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-subtle">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">
          {title}
        </h1>
        {description && (
          <div className="text-[14px] leading-relaxed text-ink-muted">{description}</div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.header>
  )
}

/** Section divider used to separate the tiers of the information hierarchy. */
export function SectionHeading({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
        {description && <p className="text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
