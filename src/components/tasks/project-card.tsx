import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { shortDay } from '@/lib/tasks/dates';
import { projectColor } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';
import type { ProjectCard } from '@/server/services/tasks';
import { AvatarStack } from './avatars';

/**
 * A project. The compact form is the tile of the overview (people, name, "N tasks open"); the large form is the
 * card of the Projects page, with a progress bar and the numbers that matter.
 */
export function ProjectCardView({ card, size = 'compact', today }: { card: ProjectCard; size?: 'compact' | 'large'; today?: string }) {
  const { project, open, done, overdue, nextDue, members } = card;
  const color = projectColor(project.color);
  const total = open + done;
  const archived = Boolean(project.archivedAt);
  const href = `/tasks/projects/${project.id}`;

  if (size === 'compact') {
    return (
      <Link href={href} className={cn('group flex min-h-32 flex-col justify-between gap-5 rounded-2xl border border-black/5 bg-white p-4 transition-colors hover:border-brand-500', archived && 'opacity-60')}>
        <div className="flex items-center justify-between">
          {members.length ? <AvatarStack people={members} size="sm" max={4} /> : <span className={cn('size-2.5 rounded-full', color.dot)} aria-hidden />}
          {overdue > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">{overdue} late</span>}
        </div>
        <div>
          <p className="font-medium leading-snug text-slate-900">{project.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
            {open} {open === 1 ? 'task' : 'tasks'} open
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </p>
        </div>
      </Link>
    );
  }

  return (
    <Link href={href} className={cn('group flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md', archived && 'opacity-70')}>
      <span className={cn('h-1.5 w-full', color.bar)} aria-hidden />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-base font-semibold leading-snug text-slate-900">{project.name}</p>
            {archived && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Archived</span>}
          </div>
          {project.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{project.description}</p>}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
            <span>{total === 0 ? 'No tasks yet' : `${done} of ${total} done`}</span>
            {total > 0 && <span className="tabular-nums">{Math.round((done / total) * 100)}%</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className={cn('h-full rounded-full', color.bar)} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="mt-auto flex items-end justify-between gap-3">
          <div className="space-y-0.5 text-xs text-slate-500">
            <p>
              <span className="font-medium text-slate-800">{open}</span> open
              {overdue > 0 && <span className="font-medium text-red-700"> · {overdue} overdue</span>}
            </p>
            {nextDue && <p>Next due {shortDay(nextDue, today)}</p>}
          </div>
          <AvatarStack people={members} max={4} />
        </div>
      </div>
    </Link>
  );
}
