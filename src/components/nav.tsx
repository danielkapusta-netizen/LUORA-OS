'use client';

import { BarChart3, Boxes, ChevronRight, Ellipsis, LayoutDashboard, LogOut, Menu, ReceiptText, Settings, ShoppingBag, SquareCheckBig, Tag, Truck, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/** The sidebar's contents: logo, links, language and the signed-in user. Shared by the wide-screen sidebar and the tablet drawer. */
function SidebarContent({ items, userName, mock, taskBadge = 0, logoutAction, trailing }: Props & { items: typeof ITEMS; /** Shown at the end of the logo row (the drawer's close button). */ trailing?: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  return (
    <>
      <div className="flex items-center gap-2 px-6 pt-6 pb-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers */}
        <img src="/logo-dark.png" alt="Luora" className="h-6 w-auto" />
        {mock && <span className="ml-auto rounded-full bg-butter px-2 py-0.5 text-[10px] font-semibold tracking-wide text-butter-ink uppercase">{t('Demo')}</span>}
        {trailing && <span className={cn('-my-2 -mr-3', !mock && 'ml-auto')}>{trailing}</span>}
      </div>
      <nav aria-label={t('Main')} className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'press flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors 2xl:min-h-10',
                active ? 'bg-sidebar-active font-medium text-ink' : 'text-slate-600 hover:bg-black/[0.035] hover:text-ink',
              )}
            >
              <Icon className="size-[18px]" strokeWidth={active ? 2 : 1.75} aria-hidden />
              {t(label)}
              {href === '/tasks' && taskBadge > 0 && (
                <span className="ml-auto flex min-w-5 items-center justify-center rounded-full bg-ink px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white" title={t('Your tasks due today or late')}>
                  {taskBadge > 99 ? '99+' : taskBadge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-3 p-3">
        <LanguageSwitcher className="px-2" />
        <div className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-3 py-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-xs font-semibold text-ink">{initials(userName)}</span>
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{userName}</p>
          <form action={logoutAction}>
            <button className="press flex size-9 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-black/[0.05] hover:text-ink" aria-label={t('Sign out')} title={t('Sign out')}>
              <LogOut className="size-4" aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export function Nav(props: Props) {
  const items = ITEMS.filter((item) => canSeePath(props.role, item.href));
  return (
    <>
      {/* Wide screens (from 1536 px): the sidebar is always there. */}
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-black/[0.06] bg-sidebar text-ink 2xl:sticky 2xl:top-0 2xl:flex 2xl:h-screen">
        <SidebarContent {...props} items={items} />
      </aside>
      <TabletNav {...props} items={items} />
      <MobileNav {...props} items={items} />
    </>
  );
}

/**
 * Tablets and laptops (768–1535 px, e.g. a Surface Pro in landscape): the sidebar is hidden so the page gets
 * the full width. A slim translucent bar holds a menu button that slides the sidebar in from the left, over a
 * dimmed page. It leaves the way it came, closes on a link, Esc, a tap outside or a swipe left, and hands focus
 * back to the button.
 */
function TabletNav(props: Props & { items: typeof ITEMS }) {
  const { userName } = props;
  const pathname = usePathname();
  const t = useT();
  // Like the phone sheets, the drawer belongs to the page it was opened on, so any navigation closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const swipe = useRef<number | null>(null);
  const wasOpen = useRef(false);
  const close = useCallback(() => setOpenedOn(null), []);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      panel.current?.querySelector<HTMLElement>('a[aria-current="page"], a')?.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
        // Keep Tab inside the drawer while it is open.
        if (e.key === 'Tab' && panel.current) {
          const f = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')];
          if (!f.length) return;
          const first = f[0];
          const last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      button.current?.focus({ preventScroll: true });
    }
  }, [open, close]);

  return (
    <div className="no-print hidden md:block 2xl:hidden">
      <header className="material-bar sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-black/[0.06] px-3">
        <button
          ref={button}
          type="button"
          onClick={() => setOpenedOn(pathname)}
          aria-label={t('Menu')}
          aria-expanded={open}
          aria-controls="tablet-drawer"
          className="press flex size-11 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-black/[0.05]"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Link href="/" aria-label={t('Luora, go to the dashboard')} className="press flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers */}
          <img src="/logo-dark.png" alt="" className="h-5 w-auto" />
        </Link>
        <span className="ml-auto flex size-9 items-center justify-center rounded-full bg-white text-xs font-semibold ring-1 ring-black/10" title={userName}>
          {initials(userName)}
        </span>
      </header>

      <div
        className={cn('fixed inset-0 z-40 bg-ink/25 transition-opacity duration-300 motion-reduce:duration-150', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={close}
        aria-hidden
      />
      <div
        id="tablet-drawer"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('Menu')}
        inert={!open}
        onPointerDown={(e) => (swipe.current = e.clientX)}
        onPointerUp={(e) => {
          if (swipe.current !== null && e.clientX - swipe.current < -60) close();
          swipe.current = null;
        }}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar text-ink',
          'transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-opacity motion-reduce:duration-150',
          // The shadow only while open, so a closed drawer leaves no edge on the page.
          open ? 'translate-x-0 shadow-[0_24px_64px_-24px_rgba(28,27,25,0.45)]' : '-translate-x-full motion-reduce:translate-x-0 motion-reduce:opacity-0',
        )}
      >
        <SidebarContent
          {...props}
          trailing={
            <button type="button" onClick={close} aria-label={t('Close')} className="press flex size-11 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-black/[0.05] hover:text-ink">
              <X className="size-5" aria-hidden />
            </button>
          }
        />
      </div>
    </div>
  );
}

function Account({ userName, role, logoutAction }: Pick<Props, 'userName' | 'role' | 'logoutAction'>) {
  const t = useT();
  return (
    <div className="rounded-2xl bg-slate-900/[0.04] p-3">
      <div className="flex items-center gap-3 px-1 py-1">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">{initials(userName)}</span>
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
      <header className="material-brand sticky top-0 z-30 flex items-center justify-between border-b border-black/[0.06] px-4 pt-[env(safe-area-inset-top)] text-ink" style={{ height: 'calc(3.25rem + env(safe-area-inset-top))' }}>
        <Link href="/" aria-label={t('Luora, go to the dashboard')} className="press flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers */}
          <img src="/logo-dark.png" alt="" className="h-5 w-auto" />
          {mock && <span className="rounded-full bg-butter px-2 py-0.5 text-[10px] font-semibold tracking-wide text-butter-ink uppercase">{t('Demo')}</span>}
        </Link>
        <button type="button" onClick={() => setSheet('account')} aria-label={t('Account: {name}', { name: userName })} className="press -mr-1 flex size-11 items-center justify-center">
          <span className="flex size-8 items-center justify-center rounded-full bg-white text-xs font-semibold ring-1 ring-black/10">{initials(userName)}</span>
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
                {tasksInMore && taskBadge > 0 && <span className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-ink ring-2 ring-white" aria-label={t('{n} tasks due', { n: taskBadge })} />}
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
                {href === '/tasks' && taskBadge > 0 && <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-white">{taskBadge > 99 ? '99+' : taskBadge}</span>}
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
