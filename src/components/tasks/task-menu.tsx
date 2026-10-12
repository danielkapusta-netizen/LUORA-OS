'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { deleteTaskAction, moveTaskAction, toggleAssignMeAction } from '@/app/(app)/tasks/actions';
import type { ActionResult } from '@/lib/action-result';
import { STATUS_LABEL, TASK_STATUSES, type TaskStatus } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';

const ITEM = 'block w-full rounded-lg px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50';

/** The "…" menu of a task card: open, move to another column, assign yourself, delete. */
export function TaskMenu({ id, status, assignedToMe, canDelete }: { id: string; status: TaskStatus; assignedToMe: boolean; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const run = (action: () => Promise<ActionResult>) =>
    start(async () => {
      setOpen(false);
      const result = await action();
      if (result?.error) window.alert(result.error);
    });

  return (
    <div ref={ref} className={cn('relative', pending && 'opacity-50')}>
      <button
        type="button"
        aria-label="Task actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <Ellipsis className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          <Link role="menuitem" href={`/tasks/${id}`} className={ITEM}>
            Open
          </Link>
          {TASK_STATUSES.filter((s) => s !== status).map((s) => (
            <button key={s} type="button" role="menuitem" className={ITEM} onClick={() => run(() => moveTaskAction(id, s))}>
              Move to {STATUS_LABEL[s]}
            </button>
          ))}
          <button type="button" role="menuitem" className={ITEM} onClick={() => run(() => toggleAssignMeAction(id))}>
            {assignedToMe ? 'Take me off' : 'Assign to me'}
          </button>
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              className={cn(ITEM, 'text-red-700 hover:bg-red-50')}
              onClick={() => {
                if (window.confirm('Delete this task? This cannot be undone.')) run(() => deleteTaskAction(id));
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
