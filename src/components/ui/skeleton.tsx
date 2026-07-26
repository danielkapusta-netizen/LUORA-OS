import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Loading placeholders mirror the exact geometry of the content they stand in
 * for, so the page does not reflow when data lands.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-sunken', className)}
      aria-hidden="true"
      {...props}
    />
  )
}
