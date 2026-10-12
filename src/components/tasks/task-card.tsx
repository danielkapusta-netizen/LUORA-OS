import { ListChecks, MessageSquare, ShoppingBag, Users } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { TaskCard } from '@/server/services/tasks';
import { AvatarStack } from './avatars';
import { DueChip, PriorityFlag, ProjectChip, TagChip } from './chips';
import { DoneToggle } from './done-toggle';
import { TaskMenu } from './task-menu';

export interface CardProps {
  card: TaskCard;
  /** Today in Warsaw (YYYY-MM-DD): decides what shows as overdue. */
  today: string;
  me: { id: string; role: string };
  /** "row" for lists, "card" for boards and grids. */
  variant?: 'row' | 'card';
  /** "time" in a day's own list (the slot, or "All day"); "day" elsewhere. */
  due?: 'time' | 'day';
  /** Title only, for dense lists. */
  compact?: boolean;
  tagHref?: (tag: string) => string;
  showProject?: boolean;
}

function Meta({ card, tagHref, showProject }: Pick<CardProps, 'card' | 'tagHref' | 'showProject'>) {
  const hasProject = showProject && card.project;
  if (!hasProject && card.tags.length === 0 && card.progress.total === 0 && card.commentCount === 0 && !card.customer && !card.order) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
      {hasProject && <ProjectChip project={card.project!} />}
      {card.tags.slice(0, 3).map((tag) => (
        <TagChip key={tag} tag={tag} href={tagHref?.(tag)} />
      ))}
      {card.tags.length > 3 && <span>+{card.tags.length - 3}</span>}
      {card.progress.total > 0 && (
        <span className="inline-flex items-center gap-1" title="Checklist">
          <ListChecks className="size-3.5" aria-hidden />
          {card.progress.done}/{card.progress.total}
        </span>
      )}
      {card.commentCount > 0 && (
        <span className="inline-flex items-center gap-1" title="Comments">
          <MessageSquare className="size-3.5" aria-hidden />
          {card.commentCount}
        </span>
      )}
      {card.customer && (
        <Link href={`/customers/${card.customer.id}`} className="inline-flex max-w-40 items-center gap-1 hover:text-slate-900 hover:underline">
          <Users className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{card.customer.name}</span>
        </Link>
      )}
      {card.order && (
        <Link href={`/orders/${card.order.id}`} className="inline-flex items-center gap-1 hover:text-slate-900 hover:underline">
          <ShoppingBag className="size-3.5" aria-hidden />
          {card.order.number}
        </Link>
      )}
    </div>
  );
}

/** One task as a card. The same component serves the lists, the board, the calendar and the project pages. */
export function TaskCardView({ card, today, me, variant = 'row', due = 'day', compact = false, tagHref = (tag) => `/tasks?tag=${encodeURIComponent(tag)}`, showProject = true }: CardProps) {
  const done = card.status === 'done';
  const menu = (
    <TaskMenu id={card.id} status={card.status} assignedToMe={card.assignees.some((a) => a.id === me.id)} canDelete={!card.createdBy || card.createdBy === me.id || me.role === 'admin'} />
  );
  const title = (
    <Link href={`/tasks/${card.id}`} className={cn('font-medium leading-snug text-slate-900 hover:underline', done && 'text-slate-400 line-through')}>
      {card.title}
    </Link>
  );

  if (variant === 'card') {
    return (
      <article className={cn('space-y-2.5 rounded-2xl border border-black/5 bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md', done && 'opacity-70')}>
        <div className="flex items-start gap-2.5">
          <DoneToggle id={card.id} done={done} title={card.title} />
          <div className="min-w-0 flex-1">{title}</div>
          {menu}
        </div>
        {!compact && card.description && <p className="line-clamp-2 text-sm text-slate-500">{card.description}</p>}
        {!compact && <Meta card={card} tagHref={tagHref} showProject={showProject} />}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <DueChip task={card} today={today} mode={due} />
            <PriorityFlag priority={card.priority} />
          </div>
          <AvatarStack people={card.assignees} size="sm" />
        </div>
      </article>
    );
  }

  return (
    <article className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md', done && 'opacity-70')}>
      <DoneToggle id={card.id} done={done} title={card.title} />
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {title}
          <PriorityFlag priority={card.priority} />
        </div>
        {!compact && card.description && <p className="mt-0.5 truncate text-sm text-slate-500">{card.description}</p>}
        {!compact && <Meta card={card} tagHref={tagHref} showProject={showProject} />}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <AvatarStack people={card.assignees} />
        {menu}
        <DueChip task={card} today={today} mode={due} />
      </div>
    </article>
  );
}
