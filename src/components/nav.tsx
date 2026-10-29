'use client';

import { BarChart3, Boxes, ChevronRight, Ellipsis, LayoutDashboard, LogOut, ReceiptText, Settings, ShoppingBag, SquareCheckBig, Tag, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/msg';
import { canSeePath, isRole, ROLE_LABEL } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from './i18n/language-switcher';
import { Sheet } from './sheet';

const ITEMS = [
  { href: '/', label: msg('Dashboard'), icon: LayoutDashboard },
  { href: '/orders', label: msg('Orders'), icon: ShoppingBag },
  { href: '/shipments', label: msg('Shipments'), icon: Truck },
  { href: '/inventory', label: msg('Inventory'), icon: Boxes },
  { href: '/pricing', label: msg('Pricing'), icon: Tag },
  { href: '/customers', label: msg('Customers'), icon: Users },
  { href: '/tasks', label: msg('Tasks'), icon: SquareCheckBig },
  { href: '/accounting', label: msg('Accounting'), icon: ReceiptText },
  { href: '/analytics', label: msg('Analytics'), icon: BarChart3 },
  { href: '/settings', label: msg('Settings'), icon: Settings },
];

/** The four pages a phone's tab bar keeps one tap away; everything else lives under "More". */
const TABS = ['/', '/orders', '/shipments', '/inventory'];

type Props = { userName: string; role: string; mock: boolean; /** My tasks due today or already late. */ taskBadge?: number; logoutAction: () => Promise<void> };

const isActive = (pathname: string, href: string) => pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function Nav(props: Props) {
  const { userName, role, mock, taskBadge = 0, logoutAction } = props;
  const pathname = usePathname();
  const t = useT();
  const items = ITEMS.filter((item) => canSeePath(role, item.href));
  return (
    <>
      {/* Wide screens: the sidebar. */}
      <aside className="no-print hidden w-60 shrink-0 flex-col bg-sidebar text-white md:sticky md:top-0 md:flex md:h-screen">
        <div className="flex items-center gap-2 px-6 py-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers */}
          <img src="/logo-light.png" alt="Luora" className="h-6 w-auto" />
          {mock && <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">{t('Demo')}</span>}
        </div>
        <nav className="flex flex-1 flex-col gap-1.5 px-3 pb-3">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors',
                isActive(pathname, href) ? 'bg-sidebar-active text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon className="size-4" />
              {t(label)}
              {href === '/tasks' && taskBadge > 0 && (
                <span className="ml-auto rounded-full bg-orange-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white" title={t('Your tasks due today or late')}>
                  {taskBadge > 99 ? '99+' : taskBadge}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <LanguageSwitcher tone="dark" className="mb-4" />
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold">{initials(userName)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{userName}</p>
              <form action={logoutAction}>
                <button className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white">
                  <LogOut className="size-3.5" /> {t('Sign out')}
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>
      <MobileNav {...props} items={items} />
    </>
  );
}

function Account({ userName, role, logoutAction }: Pick<Props, 'userName' | 'role' | 'logoutAction'>) {
  const t = useT();
  return (
    <div className="rounded-2xl bg-slate-900/[0.04] p-3">
      <div className="flex items-center gap-3 px-1 py-1">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sidebar text-sm font-semibold text-white">{initials(userName)}</span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{userName}</p>
          <p className="text-sm text-slate-500">{isRole(role) ? t(ROLE_LABEL[role]) : role}</p>
        </div>
      </div>
      <LanguageSwitcher className="mt-3 justify-between px-1" />
      <form action={logoutAction} className="mt-3">
        <button className="press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-base font-semibold text-red-700 ring-1 ring-red-200 active:bg-red-50">
          <LogOut className="size-4" aria-hidden /> {t('Sign out')}
        </button>
      </form>
    </div>
  );
}

/** Phone chrome: a slim translucent top bar, a tab bar under the thumb, and a sheet for the rest. */
function MobileNav({ items, userName, role, mock, taskBadge = 0, logoutAction }: Props & { items: typeof ITEMS }) {
  const pathname = usePathname();
  const t = useT();
  // A sheet belongs to the page it was opened on, so any navigation closes it, however the link was followed.
  const [opened, setOpened] = useState<{ kind: 'more' | 'account'; path: string } | null>(null);
  const sheet = opened?.path === pathname ? opened.kind : null;
  const setSheet = (kind: 'more' | 'account') => setOpened({ kind, path: pathname });
  const close = useCallback(() => setOpened(null), []);

  const tabs = items.filter((i) => TABS.includes(i.href));
  const more = items.filter((i) => !TABS.includes(i.href));
  const moreActive = more.some((i) => isActive(pathname, i.href));
  const tasksInMore = more.some((i) => i.href === '/tasks');
  const tab = 'press relative flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-wide';

  return (
    <div className="no-print md:hidden">
      <header className="material-brand sticky top-0 z-30 flex items-center justify-between px-4 pt-[env(safe-area-inset-top)] text-white" style={{ height: 'calc(3.25rem + env(safe-area-inset-top))' }}>
        <Link href="/" aria-label={t('Luora, go to the dashboard')} className="press flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers */}
          <img src="/logo-light.png" alt="" className="h-5 w-auto" />
          {mock && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">{t('Demo')}</span>}
        </Link>
        <button type="button" onClick={() => setSheet('account')} aria-label={t('Account: {name}', { name: userName })} className="press -mr-1 flex size-11 items-center justify-center">
          <span className="flex size-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold ring-1 ring-white/20">{initials(userName)}</span>
        </button>
      </header>

      <nav aria-label={t('Main')} className="material-bar fixed inset-x-0 bottom-0 z-30 border-t border-black/10 pb-[env(safe-area-inset-bottom)]">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? 'page' : undefined} className={cn(tab, 'w-full', active ? 'text-brand-700' : 'text-slate-500')}>
                  <Icon className="size-6" strokeWidth={active ? 2.3 : 1.8} aria-hidden />
                  {t(label)}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setSheet('more')} aria-haspopup="dialog" className={cn(tab, 'w-full', moreActive || sheet === 'more' ? 'text-brand-700' : 'text-slate-500')}>
              <span className="relative">
                <Ellipsis className="size-6" strokeWidth={moreActive ? 2.3 : 1.8} aria-hidden />
                {tasksInMore && taskBadge > 0 && <span className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-orange-500 ring-2 ring-white" aria-label={t('{n} tasks due', { n: taskBadge })} />}
              </span>
              {t('More')}
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={sheet === 'more'} onClose={close} title={t('More')}>
        <ul className="overflow-hidden rounded-2xl bg-slate-900/[0.04]">
          {more.map(({ href, label, icon: Icon }, i) => (
            <li key={href} className={cn(i > 0 && 'border-t border-slate-900/5')}>
              <Link href={href} onClick={close} className="press flex min-h-14 items-center gap-3 px-4 active:bg-slate-900/5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className={cn('flex-1 text-base font-medium', isActive(pathname, href) && 'text-brand-700')}>{t(label)}</span>
                {href === '/tasks' && taskBadge > 0 && <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">{taskBadge > 99 ? '99+' : taskBadge}</span>}
                <ChevronRight className="size-4 text-slate-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <Account userName={userName} role={role} logoutAction={logoutAction} />
        </div>
      </Sheet>

      <Sheet open={sheet === 'account'} onClose={close} title={t('Account')}>
        <Account userName={userName} role={role} logoutAction={logoutAction} />
      </Sheet>
    </div>
  );
}
