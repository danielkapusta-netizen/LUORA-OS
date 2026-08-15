import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { SidebarContent } from '@/app/sidebar'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSnapshot } from '@/hooks/use-snapshot'
import { useTheme } from '@/hooks/use-theme'
import { fade, springDrawer } from '@/lib/motion'

/**
 * Desktop-first chrome: a fixed sidebar and a single scrolling content column
 * capped at a readable width. Below `lg` the sidebar becomes an overlay drawer
 * so no layout is ever compressed into unreadability.
 *
 * The sidebar is a material rather than a painted panel. A heavier, slightly
 * recessed translucency is what separates a structural region from the content
 * it frames — the same reason a native sidebar never matches the document
 * behind it.
 */
export function AppShell() {
  const { theme, toggleTheme } = useTheme()
  const { snapshot } = useSnapshot()
  const [isDrawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Route changes close the drawer; an open overlay after navigation reads as a bug.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  const actionableInsights =
    snapshot?.insights.filter((insight) => insight.severity !== 'info').length ?? 0

  return (
    /*
     * CSS media queries cannot reach animations that Framer Motion drives from
     * JavaScript, so the preference is handed to it directly. `reducedMotion`
     * keeps opacity changes — which are what confirm the interface responded —
     * and drops the travel and overshoot that cause trouble.
     */
    <MotionConfig reducedMotion="user">
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-canvas">
        <aside className="material-thick fixed inset-y-0 left-0 z-30 hidden w-[236px] border-r border-hairline lg:block">
          <SidebarContent
            insightCount={actionableInsights}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </aside>

        {/* Compact chrome floats over the content rather than reserving a strip
            from it, so the page keeps its full height while scrolling. */}
        <div className="material-regular sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div className="flex items-baseline gap-1.5">
            <span className="t-strong vibrant text-ink">Luora</span>
            <span className="t-label text-ink-subtle">OS</span>
          </div>
        </div>

        <AnimatePresence>
          {isDrawerOpen && (
            <>
              {/* A modal task dims what it covers: the scrim says the rest of
                  the app is parked, not merely behind. */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
                className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px] lg:hidden"
                onClick={() => setDrawerOpen(false)}
              />
              {/* It leaves the way it arrived. A panel that slides in from the
                  left and dismisses anywhere else breaks the spatial model. */}
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={springDrawer}
                className="material-thick fixed inset-y-0 left-0 z-50 w-[264px] border-r border-hairline lg:hidden"
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
    </MotionConfig>
  )
}
