// What a task looks like, without the database: labels, colours, sorting, grouping and the productivity figures.
import { addDays, daysBetween } from './dates';

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TASK_COMMENT_KINDS = ['comment', 'event'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export const isTaskStatus = (v: unknown): v is TaskStatus => (TASK_STATUSES as readonly unknown[]).includes(v);
export const isTaskPriority = (v: unknown): v is TaskPriority => (TASK_PRIORITIES as readonly unknown[]).includes(v);

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/** Colours of the priority flag and chip on a card. Full class names, so Tailwind finds them. */
export const PRIORITY_STYLE: Record<TaskPriority, { flag: string; chip: string }> = {
  urgent: { flag: 'text-red-600', chip: 'bg-red-50 text-red-700 ring-red-600/20' },
  high: { flag: 'text-orange-500', chip: 'bg-orange-50 text-orange-700 ring-orange-600/20' },
  normal: { flag: 'text-slate-400', chip: 'bg-slate-100 text-slate-700 ring-transparent' },
  low: { flag: 'text-slate-300', chip: 'bg-slate-50 text-slate-500 ring-transparent' },
};

// ---------------------------------------------------------------- colours

export const PROJECT_COLORS = {
  lime: { dot: 'bg-lime-400', soft: 'bg-lime-100 text-lime-900', bar: 'bg-lime-400' },
  orange: { dot: 'bg-orange-500', soft: 'bg-orange-100 text-orange-900', bar: 'bg-orange-500' },
  sky: { dot: 'bg-sky-500', soft: 'bg-sky-100 text-sky-900', bar: 'bg-sky-500' },
  violet: { dot: 'bg-violet-500', soft: 'bg-violet-100 text-violet-900', bar: 'bg-violet-500' },
  rose: { dot: 'bg-rose-500', soft: 'bg-rose-100 text-rose-900', bar: 'bg-rose-500' },
  emerald: { dot: 'bg-emerald-500', soft: 'bg-emerald-100 text-emerald-900', bar: 'bg-emerald-500' },
  amber: { dot: 'bg-amber-400', soft: 'bg-amber-100 text-amber-900', bar: 'bg-amber-400' },
  slate: { dot: 'bg-slate-500', soft: 'bg-slate-200 text-slate-800', bar: 'bg-slate-500' },
} as const;
export type ProjectColor = keyof typeof PROJECT_COLORS;
export const PROJECT_COLOR_KEYS = Object.keys(PROJECT_COLORS) as ProjectColor[];

export function projectColor(key: string | null | undefined) {
  return PROJECT_COLORS[(key ?? 'slate') as ProjectColor] ?? PROJECT_COLORS.slate;
}

function hash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h;
}

const TAG_STYLES = [
  'bg-lime-300 text-slate-900',
  'bg-orange-500 text-white',
  'bg-slate-200 text-slate-700',
  'bg-sky-200 text-sky-900',
  'bg-violet-200 text-violet-900',
  'bg-rose-200 text-rose-900',
];

/** A tag always gets the same colour. */
export function tagStyle(tag: string): string {
  return TAG_STYLES[hash(tag.toLowerCase()) % TAG_STYLES.length];
}

const AVATAR_STYLES = ['bg-orange-500', 'bg-sky-600', 'bg-violet-600', 'bg-emerald-600', 'bg-rose-500', 'bg-amber-500', 'bg-teal-600', 'bg-indigo-600'];

export function avatarStyle(userId: string): string {
  return `${AVATAR_STYLES[hash(userId) % AVATAR_STYLES.length]} text-white`;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

// ---------------------------------------------------------------- tags and checklists

export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 30);
}

/** Tags typed as "posters, #ideas" (or already split) become clean, unique tags; at most ten. */
export function parseTags(input: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[,;\n]+/);
  return [...new Set(parts.map(normalizeTag).filter(Boolean))].slice(0, 10);
}

export function checklistProgress(items: readonly ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

export function newChecklistItem(text: string): ChecklistItem {
  return { id: crypto.randomUUID(), text: text.trim().slice(0, 200), done: false };
}

// ---------------------------------------------------------------- ordering and grouping

interface Sortable {
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  startTime: string | null;
}

/** Open before done, then by day (undated last), time of day, priority (highest first) and title. */
export function compareTasks(a: Sortable, b: Sortable): number {
  const done = Number(a.status === 'done') - Number(b.status === 'done');
  if (done) return done;
  if (a.dueDate !== b.dueDate) return a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate < b.dueDate ? -1 : 1;
  if (a.startTime !== b.startTime) return a.startTime === null ? 1 : b.startTime === null ? -1 : a.startTime < b.startTime ? -1 : 1;
  const priority = (PRIORITY_RANK[b.priority as TaskPriority] ?? 1) - (PRIORITY_RANK[a.priority as TaskPriority] ?? 1);
  return priority || a.title.localeCompare(b.title, 'pl');
}

export type DueState = 'done' | 'overdue' | 'today' | 'soon' | 'later' | 'none';

/** How urgent a task's day is: overdue, today, within two days, later, or no day at all. */
export function dueState(task: { status: string; dueDate: string | null }, now: string): DueState {
  if (task.status === 'done') return 'done';
  if (!task.dueDate) return 'none';
  const diff = daysBetween(now, task.dueDate);
  return diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff <= 2 ? 'soon' : 'later';
}

/**
 * The list for one day: what is overdue (only when looking at today), what is planned for the day, and open
 * tasks without a day. Each list is in task order.
 */
export function groupForDay<T extends Sortable>(items: readonly T[], day: string, now: string): { overdue: T[]; planned: T[]; undated: T[] } {
  const sorted = [...items].sort(compareTasks);
  return {
    overdue: day === now ? sorted.filter((t) => t.status !== 'done' && t.dueDate !== null && t.dueDate < now) : [],
    planned: sorted.filter((t) => t.dueDate === day),
    undated: sorted.filter((t) => t.status !== 'done' && t.dueDate === null),
  };
}

// ---------------------------------------------------------------- productivity

/** Share of the day's tasks that are done (0 to 1), or null when nothing is planned for the day. */
export function doneShare(dayTasks: readonly { status: string }[]): number | null {
  if (dayTasks.length === 0) return null;
  return dayTasks.filter((t) => t.status === 'done').length / dayTasks.length;
}

/** Share of finished tasks that had a day and were finished on or before it (0 to 1), or null with no such task. */
export function onTimeRate(rows: readonly { dueDate: string | null; doneDay: string }[]): number | null {
  const dated = rows.filter((r) => r.dueDate);
  if (dated.length === 0) return null;
  return dated.filter((r) => r.doneDay <= r.dueDate!).length / dated.length;
}

/** Tasks finished on each of the last `days` days, oldest first, the last entry being `now`. */
export function completedPerDay(doneDays: readonly string[], now: string, days = 7): { day: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of doneDays) counts.set(d, (counts.get(d) ?? 0) + 1);
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(now, i - (days - 1));
    return { day, count: counts.get(day) ?? 0 };
  });
}
