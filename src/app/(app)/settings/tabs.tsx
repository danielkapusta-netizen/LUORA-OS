'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/shipping', label: 'Shipping rules & packages' },
  { href: '/settings/accounting', label: 'Accounting' },
  { href: '/settings/costs', label: 'Costs & margins' },
  { href: '/settings/users', label: 'Users' },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-5 flex gap-1 border-b border-slate-200">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
            pathname.startsWith(t.href) ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
