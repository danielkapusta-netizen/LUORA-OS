import type { BoardColumn } from '@/components/tasks/board';
import { TaskCardView } from '@/components/tasks/task-card';
import { NewTaskDialog, type TaskDefaults } from '@/components/tasks/task-dialog';
import { compareTasks, TASK_STATUSES } from '@/lib/tasks/model';
import { msg } from '@/lib/i18n/msg';
import type { T } from '@/lib/i18n/translate';
import type { TaskCard } from '@/server/services/tasks';

const EMPTY = { todo: msg('Nothing waiting'), in_progress: msg('Nothing under way'), done: msg('Nothing finished yet') } as const;

/** The three status columns of a board, each with its cards and an "add" button that pre-fills the status. */
export function statusColumns({
  t,
  cards,
  today,
  me,
  dialog,
  defaults = {},
  tagHref,
}: {
  t: T;
  cards: TaskCard[];
  today: string;
  me: { id: string; role: string };
  dialog: { people: { id: string; name: string }[]; projects: { id: string; name: string }[]; tags: string[]; meId: string };
  defaults?: TaskDefaults;
  tagHref: (tag: string) => string;
}): BoardColumn[] {
  return TASK_STATUSES.map((status) => ({
    status,
    empty: t(EMPTY[status]),
    header: <NewTaskDialog {...dialog} label="" variant="ghost" size="sm" buttonClassName="size-8 px-0" defaults={{ ...defaults, status }} />,
    items: cards
      .filter((c) => c.status === status)
      .sort(status === 'done' ? (a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0) : compareTasks)
      .map((c) => ({ id: c.id, node: <TaskCardView card={c} today={today} me={me} variant="card" due="day" tagHref={tagHref} /> })),
  }));
}
