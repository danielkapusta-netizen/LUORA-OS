'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/msg';

const TABS = [
  { href: '/tasks', label: msg('Overview') },
  { href: '/tasks/board', label: msg('Board') },
  { href: '/tasks/calendar', label: msg('Calendar') },
  { href: '/tasks/projects', label: msg('Projects') },
];

export function TaskTabs() {
  const pathname = usePathname();
  const t = useT();
  // The person filter follows you from tab to tab.
  const who = useSearchParams().get('who');
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((tab, i) => {
        // A single task's page sits under /tasks but belongs to the overview.
        const active = i === 0 ? pathname === '/tasks' || !/^\/tasks\/(board|calendar|projects)/.test(pathname) : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={who ? `${tab.href}?who=${encodeURIComponent(who)}` : tab.href}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium max-md:px-4 max-md:py-3',
              active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </div>
  );
}
