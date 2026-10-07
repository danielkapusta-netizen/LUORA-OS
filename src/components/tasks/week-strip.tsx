import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { dayParts } from '@/lib/tasks/dates';
import { cn } from '@/lib/utils';

/**
 * The week with big day numbers, as on the reference design: a column on wide screens, a row of seven on narrow
 * ones. Each day shows how many open tasks are planned; today is marked; a click picks the day.
 */
export function WeekStrip({
  days,
  selected,
  today,
  counts,
  href,
  previousHref,
  nextHref,
  monthHref,
}: {
  days: string[];
  selected: string;
  today: string;
  counts: Record<string, { open: number; total: number }>;
  href: (day: string) => string;
  previousHref: string;
  nextHref: string;
  monthHref: string;
}) {
  return (
    <Card className="p-4 xl:px-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Calendar</h2>
        <div className="flex items-center">
          <Link href={previousHref} aria-label="Previous week" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronLeft className="size-4" />
          </Link>
          <Link href={nextHref} aria-label="Next week" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>
      <ol className="grid grid-cols-7 gap-1 xl:grid-cols-1 xl:gap-0">
        {days.map((day) => {
          const p = dayParts(day);
          const isToday = day === today;
          const isSelected = day === selected;
          const open = counts[day]?.open ?? 0;
          return (
            <li key={day}>
              <Link
                href={href(day)}
                aria-current={isSelected ? 'date' : undefined}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center transition-colors',
                  'xl:flex-row xl:items-end xl:justify-between xl:gap-3 xl:rounded-none xl:border-b xl:border-slate-100 xl:px-1 xl:py-3 xl:text-left',
                  isSelected ? 'bg-slate-900 text-white xl:bg-slate-50 xl:text-slate-900' : 'hover:bg-slate-50',
                )}
              >
                <span className={cn('text-[11px] xl:hidden', isSelected ? 'text-white/70' : 'text-slate-500')}>{p.weekday}</span>
                <span className={cn('text-xl font-semibold leading-none tabular-nums xl:text-4xl', isToday && !isSelected && 'text-brand-600', isToday && isSelected && 'xl:text-brand-600')}>{p.num}</span>
                <span className="hidden min-w-0 flex-1 text-xs leading-tight text-slate-500 xl:block xl:pb-0.5">
                  <span className={cn('block', isToday && 'font-medium text-brand-700')}>{isToday ? 'Today' : p.month}</span>
                  <span className="block">{p.weekday}</span>
                </span>
                <span
                  className={cn(
                    'min-w-5 rounded-full px-1.5 text-center text-[11px] font-medium tabular-nums xl:mb-0.5',
                    open > 0 ? (isSelected ? 'bg-white/20 text-white xl:bg-slate-900 xl:text-white' : 'bg-slate-100 text-slate-700') : 'invisible',
                  )}
                  title={open > 0 ? `${open} open` : undefined}
                >
                  {open || 0}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <Link href={monthHref} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline">
        <CalendarDays className="size-3.5" aria-hidden /> Open the month
      </Link>
    </Card>
  );
}
