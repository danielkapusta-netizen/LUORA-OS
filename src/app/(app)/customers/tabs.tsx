'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/msg';

const TABS = [
  { href: '/customers', label: msg('Customers'), exact: true },
  { href: '/customers/segments', label: msg('Segments') },
  { href: '/customers/duplicates', label: msg('Possible duplicates') },
];

export function CustomerTabs() {
  const pathname = usePathname();
  const t = useT();
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((item) => {
        // A customer's own page sits under /customers but belongs to the list tab.
        const active = item.exact ? pathname === item.href || /^\/customers\/(?!segments|duplicates)[^/]+$/.test(pathname) : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
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
