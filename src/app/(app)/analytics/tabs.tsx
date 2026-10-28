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
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.exact || !query ? item.href : `${item.href}?${query}`}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium max-md:px-4 max-md:py-3',
              active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t(item.label)}
          </Link>
        );
      })}
    </div>
  );
}
