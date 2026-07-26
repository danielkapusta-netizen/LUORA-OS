import { motion } from 'framer-motion'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Nothing to show, and that is a legitimate answer rather than a failure. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <div className="max-w-sm space-y-1.5">
        <p className="text-[15px] font-medium text-ink">{title}</p>
        {description && (
          <p className="text-[13px] leading-relaxed text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

/** Something broke. Say what, and offer the one action that might fix it. */
export function ErrorState({
  title = 'Could not load your data',
  description,
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <Card className="border-negative/25 bg-negative-soft/40">
      <div className="flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-negative-soft text-negative">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex-1 space-y-1.5">
          <p className="text-[15px] font-semibold text-ink">{title}</p>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {description ??
              'Luora could not reach the data service. This is usually a temporary Apps Script timeout.'}
          </p>
        </div>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} className="shrink-0">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        )}
      </div>
    </Card>
  )
}

/**
 * Skeleton for the Overview shell. Mirrors the real layout closely enough that
 * the transition to loaded content is a fade, not a jump.
 */
export function PageSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="space-y-10"
    >
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="p-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-8 w-32" />
            <Skeleton className="mt-4 h-5 w-24" />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card className="p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-6 h-[260px] w-full" />
        </Card>
        <Card className="p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-6 h-[260px] w-full" />
        </Card>
      </div>
    </motion.div>
  )
}
