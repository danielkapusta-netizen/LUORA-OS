'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/msg';

const TABS = [
  { href: '/settings/integrations', label: msg('Integrations') },
  { href: '/settings/shipping', label: msg('Shipping rules & packages') },
  { href: '/settings/accounting', label: msg('Accounting') },
  { href: '/settings/costs', label: msg('Costs & margins') },
  { href: '/settings/users', label: msg('Users') },
];

export function SettingsTabs() {
  const pathname = usePathname();
  const t = useT();
  return (
    <div className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 max-md:scrollbar-none md:mx-0 md:px-0">
      {TABS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium max-md:px-4 max-md:py-3',
            pathname.startsWith(item.href) ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t(item.label)}
        </Link>
      ))}
    </div>
  );
}
