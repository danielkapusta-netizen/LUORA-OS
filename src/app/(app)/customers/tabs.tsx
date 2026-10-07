'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/customers', label: 'Customers', exact: true },
  { href: '/customers/segments', label: 'Segments' },
  { href: '/customers/duplicates', label: 'Possible duplicates' },
];

export function CustomerTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((t) => {
        // A customer's own page sits under /customers but belongs to the list tab.
        const active = t.exact ? pathname === t.href || /^\/customers\/(?!segments|duplicates)[^/]+$/.test(pathname) : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
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
