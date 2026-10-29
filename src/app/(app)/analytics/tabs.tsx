'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { msg } from '@/lib/i18n/msg';
import { useT } from '@/lib/i18n/client';

const TABS = [
  { href: '/analytics', label: msg('Operations'), exact: true },
  { href: '/analytics/actions', label: msg('Action centre') },
  { href: '/analytics/review', label: msg('Business review') },
  { href: '/analytics/products', label: msg('Products') },
  { href: '/analytics/pricing', label: msg('Pricing') },
  { href: '/analytics/trends', label: msg('Trends') },
  { href: '/analytics/orders', label: msg('Orders P&L') },
  { href: '/analytics/calculator', label: msg('Calculator') },
];

/** Keeps the chosen period and marketplace when moving between tabs. */
const KEEP = ['period', 'marketplace', 'from', 'to'];

export function AnalyticsTabs() {
  const t = useT();
  const pathname = usePathname();
  const search = useSearchParams();
  const kept = new URLSearchParams();
  for (const k of KEEP) {
    const v = search.get(k);
    if (v) kept.set(k, v);
  }
  const query = kept.toString();
  return (
    // One segmented bar; on a phone it scrolls sideways and fades at the edge to show there is more.
    <nav aria-label={t('Analytics')} className="fade-end -mx-4 mb-6 overflow-x-auto px-4 max-md:scrollbar-none md:mx-0 md:px-0 md:[mask-image:none]">
      <div className="inline-flex gap-0.5 rounded-full bg-black/[0.04] p-1">
        {TABS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.exact || !query ? item.href : `${item.href}?${query}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'press shrink-0 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors max-md:py-2.5',
                active ? 'bg-white font-medium text-ink shadow-[0_1px_2px_rgba(28,27,25,0.08)]' : 'text-slate-600 hover:text-ink',
              )}
            >
              {t(item.label)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
