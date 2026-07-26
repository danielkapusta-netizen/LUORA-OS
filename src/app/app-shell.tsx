import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { SidebarContent } from '@/app/sidebar'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useBusinessContext } from '@/hooks/use-business-context'
import { useTheme } from '@/hooks/use-theme'

/**
 * Desktop-first chrome: a fixed sidebar and a single scrolling content column
 * capped at a readable width. Below `lg` the sidebar becomes an overlay drawer
 * so no layout is ever compressed into unreadability.
 */
export function AppShell() {
  const { theme, toggleTheme } = useTheme()
  const { context } = useBusinessContext()
  const [isDrawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Route changes close the drawer; an open overlay after navigation reads as a bug.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  const actionableInsights =
    context?.insights.filter((insight) => insight.severity !== 'info').length ?? 0

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-canvas">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] border-r border-hairline bg-surface lg:block">
          <SidebarContent
            insightCount={actionableInsights}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </aside>

        <div className="flex h-16 items-center gap-3 border-b border-hairline bg-surface px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Luora</span>
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
              OS
            </span>
          </div>
        </div>

        <AnimatePresence>
          {isDrawerOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px] lg:hidden"
                onClick={() => setDrawerOpen(false)}
              />
              <motion.aside
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                className="fixed inset-y-0 left-0 z-50 w-[264px] border-r border-hairline bg-surface lg:hidden"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close navigation"
                  className="absolute right-3 top-4"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
                <SidebarContent
                  insightCount={actionableInsights}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  onNavigate={() => setDrawerOpen(false)}
                />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <main className="lg:pl-[236px]">
          <div className="mx-auto w-full max-w-[1320px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
            <Outlet />
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}
