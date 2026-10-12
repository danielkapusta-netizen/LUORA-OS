'use client';

import { useOptimistic, useState, useTransition, type ReactNode } from 'react';
import { moveTaskAction } from '@/app/(app)/tasks/actions';
import { STATUS_LABEL, type TaskStatus } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';

export interface BoardItem {
  id: string;
  /** The task's card, rendered on the server. */
  node: ReactNode;
}

export interface BoardColumn {
  status: TaskStatus;
  /** Shown next to the column's title, e.g. an "add" button. */
  header?: ReactNode;
  items: BoardItem[];
  empty?: string;
}

const DOT: Record<TaskStatus, string> = { todo: 'bg-slate-400', in_progress: 'bg-amber-400', done: 'bg-emerald-500' };

/**
 * Columns of task cards. Drag a card onto another column to change its status; the card moves at once and the
 * change is saved behind it. (On a touch screen use the card's menu: "Move to…".)
 */
export function Board({ columns }: { columns: BoardColumn[] }) {
  const [shown, move] = useOptimistic(columns, (state, change: { id: string; to: TaskStatus }) => {
    const item = state.flatMap((c) => c.items).find((i) => i.id === change.id);
    if (!item) return state;
    return state.map((c) => ({ ...c, items: c.status === change.to ? [...c.items.filter((i) => i.id !== change.id), item] : c.items.filter((i) => i.id !== change.id) }));
  });
  const [, start] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  const drop = (to: TaskStatus) => {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id) return;
    if (shown.find((c) => c.items.some((i) => i.id === id))?.status === to) return;
    start(async () => {
      move({ id, to });
      const result = await moveTaskAction(id, to);
      if (result?.error) window.alert(result.error);
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {shown.map((col) => (
        <section
          key={col.status}
          aria-label={STATUS_LABEL[col.status]}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            setOver(col.status);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(col.status);
          }}
          className={cn('flex min-h-52 flex-col rounded-2xl bg-slate-100/70 p-3 transition-shadow', dragging && over === col.status && 'ring-2 ring-brand-500')}
        >
          <header className="mb-3 flex items-center justify-between gap-2 px-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span className={cn('size-2 rounded-full', DOT[col.status])} aria-hidden />
              {STATUS_LABEL[col.status]}
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500">{col.items.length}</span>
            </h2>
            {col.header}
          </header>
          <div className="flex flex-1 flex-col gap-2.5">
            {col.items.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', item.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragging(item.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                className={cn('cursor-grab active:cursor-grabbing', dragging === item.id && 'opacity-40')}
              >
                {item.node}
              </div>
            ))}
            {col.items.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">{col.empty ?? 'Nothing here'}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
