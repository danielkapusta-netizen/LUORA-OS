import Link from 'next/link';
import { dayParts, timeRange, WEEKDAYS } from '@/lib/tasks/dates';
import { projectColor } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';
import type { TaskCard } from '@/server/services/tasks';

const SHOWN = 3;

/** A month in whole weeks, Monday first, with the day's tasks as little chips in colour of their project. */
export function MonthGrid({
  weeks,
  today,
  selected,
  tasksByDay,
  dayHref,
}: {
  weeks: { day: string; inMonth: boolean }[][];
  today: string;
  selected: string | null;
  tasksByDay: Record<string, TaskCard[]>;
  dayHref: (day: string) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="min-w-[44rem]">
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={w} className="grid grid-cols-7">
            {week.map(({ day, inMonth }) => {
              const items = tasksByDay[day] ?? [];
              const open = items.filter((t) => t.status !== 'done').length;
              const isToday = day === today;
              return (
                <div
                  key={day}
                  className={cn(
                    'min-h-28 border-b border-r border-slate-100 p-1.5 last:border-r-0 [&:nth-child(7)]:border-r-0',
                    !inMonth && 'bg-slate-50/70',
                    day === selected && 'bg-brand-50/60 ring-1 ring-inset ring-brand-500',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <Link
                      href={dayHref(day)}
                      aria-label={`Show ${day}`}
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                        isToday ? 'bg-slate-900 text-white' : inMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-100',
                      )}
                    >
                      {dayParts(day).num}
                    </Link>
                    {open > 0 && <span className="text-[11px] tabular-nums text-slate-400">{open} open</span>}
                  </div>
                  <ul className="space-y-1">
                    {items.slice(0, SHOWN).map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/tasks/${t.id}`}
                          title={`${t.title}${timeRange(t.startTime, t.endTime) ? ` (${timeRange(t.startTime, t.endTime)})` : ''}`}
                          className={cn(
                            'block truncate rounded-md px-1.5 py-0.5 text-[11px] leading-snug hover:brightness-95',
                            projectColor(t.project?.color).soft,
                            t.status === 'done' && 'line-through opacity-50',
                          )}
                        >
                          {t.startTime && <span className="mr-1 tabular-nums opacity-70">{t.startTime}</span>}
                          {t.title}
                        </Link>
                      </li>
                    ))}
                    {items.length > SHOWN && (
                      <li>
                        <Link href={dayHref(day)} className="block px-1.5 text-[11px] text-slate-500 hover:text-slate-800 hover:underline">
                          +{items.length - SHOWN} more
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
