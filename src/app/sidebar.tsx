import { motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { navigation } from '@/app/navigation'
import { Badge } from '@/components/ui/badge'
import type { Theme } from '@/hooks/use-theme'
import { springSnappy } from '@/lib/motion'
import { cn } from '@/lib/utils'

export function SidebarContent({
  insightCount,
  theme,
  onToggleTheme,
  onNavigate,
}: {
  insightCount: number
  theme: Theme
  onToggleTheme: () => void
  onNavigate?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-ink">
          <span className="text-[13px] font-semibold leading-none tracking-[-0.01em] text-canvas">
            L
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="t-strong vibrant text-ink">Luora</span>
          <span className="t-label text-ink-subtle">OS</span>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {navigation.map((section) => (
          <div key={section.label} className="space-y-0.5">
            <p className="t-label px-2.5 pb-1.5 text-ink-subtle">{section.label}</p>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'press-sm group relative flex items-center gap-2.5 rounded-control px-2.5 py-2',
                    't-small font-medium',
                    'transition-colors duration-150',
                    isActive ? 'text-ink' : 'text-ink-muted hover:bg-surface/70 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* The selection travels between items rather than blinking
                        off one and on to another, so the eye stays anchored. */}
                    {isActive && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-control bg-surface shadow-card"
                        transition={springSnappy}
                      />
                    )}
                    <item.icon
                      className={cn(
                        'relative z-10 h-4 w-4 shrink-0 transition-colors',
                        isActive ? 'text-accent' : 'text-ink-subtle group-hover:text-ink-muted',
                      )}
                      aria-hidden="true"
                    />
                    <span className="relative z-10 flex-1">{item.label}</span>
                    {item.badge === 'insights' && insightCount > 0 && (
                      <Badge variant="accent" size="sm" className="relative z-10 tnum">
                        {insightCount}
                      </Badge>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-hairline p-3">
        <button
          type="button"
          onClick={onToggleTheme}
          className={cn(
            'press-sm flex w-full items-center gap-2.5 rounded-control px-2.5 py-2',
            't-small font-medium text-ink-muted',
            'transition-colors duration-150 hover:bg-surface/70 hover:text-ink',
          )}
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
          )}
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </div>
  )
}
