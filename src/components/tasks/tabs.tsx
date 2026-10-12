'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/tasks', label: 'Overview' },
  { href: '/tasks/board', label: 'Board' },
  { href: '/tasks/calendar', label: 'Calendar' },
  { href: '/tasks/projects', label: 'Projects' },
];

export function TaskTabs() {
  const pathname = usePathname();
  // The person filter follows you from tab to tab.
  const who = useSearchParams().get('who');
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((t, i) => {
        // A single task's page sits under /tasks but belongs to the overview.
        const active = i === 0 ? pathname === '/tasks' || !/^\/tasks\/(board|calendar|projects)/.test(pathname) : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={who ? `${t.href}?who=${encodeURIComponent(who)}` : t.href}
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
