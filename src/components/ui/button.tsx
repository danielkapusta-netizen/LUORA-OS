import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * The press is the important part.
 *
 * Feedback lands on pointer-down rather than on click: the moment a control
 * waits for release before acknowledging you, directness falls off a cliff.
 * The scale is small — the surface gives slightly under a finger, it does not
 * perform. Colour changes ride a slower clock than the transform so the press
 * reads as physical and the hover as a state.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control',
    'font-medium tracking-[-0.005em]',
    'transition-[background-color,border-color,color,box-shadow] duration-150',
    'disabled:pointer-events-none disabled:opacity-50',
    'press',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-ink text-canvas hover:bg-ink/90',
        secondary: 'border border-hairline-strong bg-surface text-ink hover:bg-surface-sunken',
        ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        accent: 'bg-accent text-white hover:bg-accent-ink',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4 text-sm',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
