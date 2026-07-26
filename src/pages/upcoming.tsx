import { motion } from 'framer-motion'
import { ArrowUpRight, Check } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

/**
 * A deliberate "next up" screen rather than an empty route.
 *
 * Overview is finished to production standard first; the remaining pages are
 * scoped here in the open so the shape of the product is legible before a line
 * of their UI exists.
 */
export function UpcomingPage({
  eyebrow,
  title,
  description,
  capabilities,
}: {
  eyebrow: string
  title: string
  description: string
  capabilities: readonly string[]
}) {
  return (
    <div className="space-y-10">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <Card>
          <div className="p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Planned for this page
            </p>

            <ul className="mt-6 grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2">
              {capabilities.map((capability, index) => (
                <motion.li
                  key={capability}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, delay: 0.08 + index * 0.05 }}
                  className="flex items-start gap-2.5"
                >
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                  <span className="text-[13px] leading-relaxed text-ink-muted">{capability}</span>
                </motion.li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
              <Button asChild variant="secondary">
                <Link to="/">
                  Back to Overview
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
              <p className="text-[12px] text-ink-subtle">
                The data layer powering this page is already built and live.
              </p>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  )
}
