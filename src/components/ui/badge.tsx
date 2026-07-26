import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-sunken text-ink-muted',
        outline: 'border border-hairline-strong text-ink-muted',
        accent: 'bg-accent-soft text-accent-ink',
        positive: 'bg-positive-soft text-positive',
        negative: 'bg-negative-soft text-negative',
        caution: 'bg-caution-soft text-caution',
      },
      size: {
        sm: 'px-2 py-0.5 text-[11px]',
        md: 'px-2.5 py-1 text-xs',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'sm' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
}
