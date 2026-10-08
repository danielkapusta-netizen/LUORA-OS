import { Card, CardBody } from '@/components/ui';
import { dayLabel, dayParts, today as warsawToday } from '@/lib/tasks/dates';
import { cn } from '@/lib/utils';
import type { Productivity } from '@/server/services/tasks';

/** A small ring that fills to `value` (0 to 1). */
function Ring({ value }: { value: number | null }) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 36 36" className="size-9 shrink-0 -rotate-90" aria-hidden>
      <circle cx="18" cy="18" r={radius} fill="none" strokeWidth="3.5" className="stroke-slate-200" />
      {value !== null && <circle cx="18" cy="18" r={radius} fill="none" strokeWidth="3.5" strokeLinecap="round" className="stroke-slate-900" strokeDasharray={`${circumference * value} ${circumference}`} />}
    </svg>
  );
}

function Figure({ value, label, note }: { value: number | null; label: string; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <Ring value={value} />
      <div>
        <p className="text-2xl font-semibold leading-none tabular-nums text-slate-900">{value === null ? '—' : `${Math.round(value * 100)}%`}</p>
        <p className="mt-1 text-xs text-slate-500">{label}</p>
        <p className="text-[11px] text-slate-400">{note}</p>
      </div>
    </div>
  );
}

/** Today's progress, how punctual the team is, and a bar for each of the last seven days. */
export function ProductivityCard({ data, now = warsawToday() }: { data: Productivity; now?: string }) {
  const max = Math.max(1, ...data.perDay.map((d) => d.count));
  return (
    <Card>
      <CardBody className="grid gap-6 sm:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="space-y-5">
          <Figure value={data.doneToday} label="daily tasks done" note={data.plannedToday ? `${data.plannedToday} planned for today` : 'nothing planned for today'} />
          <Figure value={data.onTime} label="finished on time" note="last 30 days" />
        </div>
        <div>
          <div className="flex h-28 items-end gap-2" role="img" aria-label={`Tasks finished per day over the last seven days: ${data.perDay.map((d) => d.count).join(', ')}`}>
            {data.perDay.map((d) => (
              <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${dayLabel(d.day, now)}: ${d.count} finished`}>
                <div
                  className={cn('w-full rounded-sm', d.count === 0 ? 'bg-slate-200' : d.day === now ? 'bg-brand-600' : 'bg-slate-900')}
                  style={{ height: `${d.count === 0 ? 4 : Math.max(10, (d.count / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2 text-[11px] text-slate-400">
            {data.perDay.map((d) => (
              <span key={d.day} className={cn('flex-1 text-center', d.day === now && 'font-medium text-slate-700')}>
                {dayParts(d.day).weekday.slice(0, 1)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {data.completedWeek} {data.completedWeek === 1 ? 'task' : 'tasks'} finished in the last 7 days
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
