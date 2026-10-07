'use client';

import { BarChart3, Boxes, LayoutDashboard, LogOut, ReceiptText, Settings, ShoppingBag, SquareCheckBig, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/shipments', label: 'Shipments', icon: Truck },
  { href: '/inventory', label: 'Inventory', icon: Boxes },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/tasks', label: 'Tasks', icon: SquareCheckBig },
  { href: '/accounting', label: 'Accounting', icon: ReceiptText },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Nav({ userName, mock, taskBadge = 0, logoutAction }: { userName: string; mock: boolean; /** My tasks due today or already late. */ taskBadge?: number; logoutAction: () => Promise<void> }) {
  const pathname = usePathname();
  return (
    <aside className="no-print flex w-full shrink-0 flex-col bg-sidebar text-white md:sticky md:top-0 md:h-screen md:w-60">
      <div className="flex items-center gap-2 px-6 py-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers */}
        <img src="/logo-light.png" alt="Luora" className="h-6 w-auto" />
        {mock && <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Demo</span>}
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-1.5 md:overflow-visible">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-sidebar-active text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon className="size-4" />
              {label}
              {href === '/tasks' && taskBadge > 0 && (
                <span className="ml-auto rounded-full bg-orange-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white" title="Your tasks due today or late">
                  {taskBadge > 99 ? '99+' : taskBadge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="hidden items-center gap-3 border-t border-white/10 px-5 py-4 md:flex">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold">
          {userName
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <div className="min-w-0">
        <p className="truncate text-sm font-medium">{userName}</p>
        <form action={logoutAction}>
          <button className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white">
            <LogOut className="size-3.5" /> Sign out
          </button>
        </form>
        </div>
      </div>
    </aside>
  );
}
