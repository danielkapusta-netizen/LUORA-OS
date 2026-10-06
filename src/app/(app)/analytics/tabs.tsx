'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/analytics', label: 'Operations', exact: true },
  { href: '/analytics/actions', label: 'Action centre' },
  { href: '/analytics/review', label: 'Business review' },
  { href: '/analytics/products', label: 'Products' },
  { href: '/analytics/pricing', label: 'Pricing' },
  { href: '/analytics/trends', label: 'Trends' },
  { href: '/analytics/orders', label: 'Orders P&L' },
  { href: '/analytics/calculator', label: 'Calculator' },
];

/** Keeps the chosen period and marketplace when moving between tabs. */
const KEEP = ['period', 'marketplace', 'from', 'to'];

export function AnalyticsTabs() {
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
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.exact || !query ? t.href : `${t.href}?${query}`}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
              active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
