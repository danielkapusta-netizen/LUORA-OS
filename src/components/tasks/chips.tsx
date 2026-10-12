import { Flag } from 'lucide-react';
import Link from 'next/link';
import { dayLabel, timeRange } from '@/lib/tasks/dates';
import { dueState, PRIORITY_LABEL, PRIORITY_STYLE, projectColor, tagStyle, type DueState, type TaskPriority } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';

/** "#posters": the same colour every time. A link when `href` is given. */
export function TagChip({ tag, href, active, className }: { tag: string; href?: string; active?: boolean; className?: string }) {
  const classes = cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', tagStyle(tag), active && 'ring-2 ring-slate-900', className);
  return href ? (
    <Link href={href} className={classes}>
      #{tag}
    </Link>
  ) : (
    <span className={classes}>#{tag}</span>
  );
}

export function ProjectChip({ project, href = true, className }: { project: { id: string; name: string; color: string }; href?: boolean; className?: string }) {
  const content = (
    <>
      <span className={cn('size-2 shrink-0 rounded-full', projectColor(project.color).dot)} aria-hidden />
      <span className="truncate">{project.name}</span>
    </>
  );
  const classes = cn('inline-flex max-w-44 items-center gap-1.5 text-xs text-slate-600', className);
  return href ? (
    <Link href={`/tasks/projects/${project.id}`} className={cn(classes, 'hover:text-slate-900 hover:underline')}>
      {content}
    </Link>
  ) : (
    <span className={classes}>{content}</span>
  );
}

const DUE_TONE: Record<DueState, string> = {
  done: 'bg-slate-100 text-slate-400',
  overdue: 'bg-red-50 text-red-700',
  today: 'bg-brand-50 text-brand-700',
  soon: 'bg-amber-50 text-amber-800',
  later: 'bg-slate-100 text-slate-600',
  none: 'bg-slate-100 text-slate-500',
};

/**
 * When a task is planned. In "time" mode (a day's own list) it shows the slot, or "All day"; in "day" mode it
 * shows the day ("Tomorrow", "Tue, 13 Oct"), followed by the slot when there is one.
 */
export function DueChip({
  task,
  today,
  mode = 'day',
  className,
}: {
  task: { status: string; dueDate: string | null; startTime: string | null; endTime: string | null };
  today: string;
  mode?: 'day' | 'time';
  className?: string;
}) {
  const slot = timeRange(task.startTime, task.endTime);
  const state = dueState(task, today);
  let label: string | null;
  if (mode === 'time') label = slot ?? (task.dueDate ? 'All day' : null);
  else label = task.dueDate ? `${dayLabel(task.dueDate, today)}${slot ? ` · ${slot}` : ''}` : null;
  if (!label) return null;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium tabular-nums', mode === 'time' && state !== 'overdue' ? 'bg-slate-100 text-slate-600' : DUE_TONE[state], className)}
      title={state === 'overdue' ? 'Overdue' : undefined}
    >
      {label}
    </span>
  );
}

/** A flag for high and urgent tasks; normal and low priority show nothing. */
export function PriorityFlag({ priority, className }: { priority: TaskPriority; className?: string }) {
  if (priority !== 'high' && priority !== 'urgent') return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', PRIORITY_STYLE[priority].flag, className)} title={`${PRIORITY_LABEL[priority]} priority`}>
      <Flag className="size-3.5" aria-hidden />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
