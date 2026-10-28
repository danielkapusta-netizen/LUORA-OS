import Link from 'next/link';
import { cn } from '@/lib/utils';
import { getT } from '@/lib/i18n/server';

/** Open tasks fetched for the Dashboard; the count shows "40+" beyond it. */
export const TASK_LIMIT = 40;

/** The "My tasks" heading of the Dashboard: the number of open tasks, in yellow as soon as there is one. */
export async function MyTasksHeading({ count, limit }: { count: number; limit: number }) {
  const t = await getT();
  return (
    <p className="flex items-center justify-between gap-2 text-sm font-semibold">
      <span className="flex items-center gap-2">
        My tasks
        <span
          className={cn('inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', count > 0 ? 'bg-amber-300 text-amber-950' : 'bg-slate-100 text-slate-500')}
          aria-label={`${count} open tasks`}
        >
          {count >= limit ? `${limit}+` : count}
        </span>
      </span>
      <Link href="/tasks?who=me" className="text-xs font-normal text-brand-700 hover:underline">
        {t('All tasks →')}
      </Link>
    </p>
  );
}

/** Card classes that tint a task card yellow while there are open tasks. */
export const tasksCardTone = (count: number) => (count > 0 ? 'border-amber-300 bg-amber-50' : undefined);
