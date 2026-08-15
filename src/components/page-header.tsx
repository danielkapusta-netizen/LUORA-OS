import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { spring, springSnappy } from '@/lib/motion'

/**
 * Every page opens the same way: what this page is, then one line of orienting
 * context, then any controls. Consistency here is what makes the product feel
 * like one system rather than a collection of screens.
 *
 * The large title scrolls away with the content, and a compact bar condenses
 * into its place. The page keeps its full opening statement, but the answer to
 * "where am I, and what am I looking at" never leaves the screen — and the
 * period control stays in reach without scrolling back up.
 *
 * The bar is portalled to the body so it never joins the page's vertical
 * rhythm; a floating layer should not be able to move the content it floats
 * over.
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
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [isCondensed, setCondensed] = useState(false)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    // Watching a sentinel rather than listening to scroll keeps this off the
    // main thread — the bar must never be the reason a scroll stutters.
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        // "Not intersecting" alone is ambiguous: the sentinel is also outside
        // the root when the page is short enough that it sits below the fold.
        // Only the case where it has passed *above* the chrome line means the
        // title has scrolled away.
        const rootTop = entry.rootBounds?.top ?? 0
        setCondensed(!entry.isIntersecting && entry.boundingClientRect.top < rootTop)
      },
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="max-w-2xl space-y-2">
        {eyebrow && <p className="t-label text-ink-subtle">{eyebrow}</p>}
        <h1 className="t-title text-ink">{title}</h1>
        {description && <div className="t-body text-ink-muted">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}

      {/* Sits at the foot of the large title: once this passes under the top of
          the viewport, the title has genuinely left and the bar takes over. */}
      <div ref={sentinelRef} aria-hidden="true" className="absolute bottom-0 left-0 h-px w-px" />

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isCondensed && (
              <motion.div
                // Glass materialises: blur and scale resolve together so it
                // reads as a surface forming, not an image being faded up.
                initial={{ opacity: 0, y: -8, filter: 'blur(8px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -8, filter: 'blur(8px)' }}
                transition={springSnappy}
                className="material-regular scroll-edge fixed inset-x-0 top-14 z-20 border-b border-hairline shadow-chrome lg:left-[236px] lg:top-0"
              >
                <div className="mx-auto flex h-14 w-full max-w-[1320px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
                  <p className="t-strong vibrant min-w-0 truncate text-ink">{title}</p>
                  {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
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
        <h2 className="t-subheading text-ink">{title}</h2>
        {description && <p className="t-small text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
